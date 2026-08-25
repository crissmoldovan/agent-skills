---
name: publish-agent-skill
description: "Publish an Agent Skill through a verified release."
license: MIT
compatibility: "Agent Skills repositories with git, a repository-specific validator/test command, an authenticated forge client for remote publication, and a release/discovery channel to verify."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Grep Glob Bash Agent Workflow
---

# Publish an Agent Skill

Author, validate, review, merge, release, and verify an Agent Skill without
assuming a repository owner, account, forge, package layout, or private delivery
system. This skill owns one explicitly selected publication target. It does not
silently copy the skill into private repositories, plugins, mirrors, websites,
sidecars, control planes, or another owner's account.

## When to Use

- “Publish this skill,” “release this Agent Skill,” or “add this skill to the
  public pack.”
- A skill draft must become a discoverable, installable, verified release.
- An existing published skill needs a versioned content update.

Do not use for a user-local skill that should remain unpublished, or for private
organization policy when a target-specific publishing skill explicitly overrides
this one.

## Publication Authority

Discover the repository, owner, publication target, skill layout, version source,
tests, review requirements, merge policy, release mechanism, and discovery
channels from the active repository and the user's request. If the target is not
uniquely known, ask before writing or publishing. Never infer a destination from
memory, a sibling clone, an installed skill, a similarly named organization, or
credentials that happen to work.

This workflow has one primary target by default.

### External and sidecar targets are opt-in only

An external target includes any second repository, private plugin, marketplace,
website, mirror, sidecar runtime, canonical-source repository, generated copy, or
local-global installation outside the primary target.

Touch one only when the user explicitly asks for or mentions that named target
in the active request. Do not infer external propagation from repository history,
links, provenance files, prior releases, available credentials, or the presence
of another checkout. When explicitly requested, treat every external target as a
separate publication with its own scope, validation, approval, readback, and
completion status. A primary release is not proof that a sidecar published.

## Prerequisites

1. Inspect repository instructions, current branch/status, recent release tags,
   skill peers, manifest/frontmatter conventions, tests, CI, and release docs.
2. Resolve the exact primary target and whether this is a new skill or update.
3. Define acceptance: skill identity, trigger, boundaries, carried files,
   discovery name, version, install command, and proof required after release.
4. Inventory external targets mentioned by the user. Record all others as out of
   scope; do not modify them.
5. Confirm authorization before remote writes, merge, publication, destructive
   replacement, or cross-account changes. Every external target must be named
   explicitly by the user in the active request; repository policy may add
   safeguards but cannot select or authorize an unmentioned target.

## Procedure

1. **Discover the target contract.** Trace validators, generators, catalog code,
   neighboring imports/links, release automation, and install commands. Do not
   invent files, fields, commands, versions, or namespaces. **Complete when:**
   repository owner, target branch, skill path, metadata contract, checks,
   release mechanism, and discovery surfaces are evidenced.
2. **Write acceptance tests first.** Add focused contract tests against the
   shipped `SKILL.md` and carried files. Run them and confirm failure for the
   missing or stale behavior. **Complete when:** RED proves the intended contract.
3. **Author the minimum skill.** Match peer structure and progressive disclosure.
   Keep triggers and counter-triggers precise; make boundaries, prerequisites,
   ordered steps, pitfalls, and verification executable. Add references/scripts
   only when the main file would otherwise carry bulky or repeated detail.
4. **Validate locally.** Run focused tests, frontmatter/link/catalog validators,
   generated-artifact drift checks, repository-required tests, and diff hygiene.
   Re-run from a clean dependency state when release reproducibility matters.
   **Complete when:** every required local check passes and the diff contains only
   intended target files.
5. **Review before publication.** Use the repository's required review gate. If
   `request-blocks-review` is installed and Blocks review is requested by the
   user or repository policy, load it and run review/fix/verify/re-review until
   the current head is clean. Never silently install a reviewer dependency.
6. **Open the publication change.** Create the repository-standard branch,
   commit, and pull request only after scope is reviewed and authorization is
   present. State tests, release impact, discovery impact, and explicitly excluded
   external targets. **Complete when:** the PR URL and exact head exist.
7. **Follow CI and review to convergence.** Distinguish queued acknowledgements
   from real reviews. Fix findings, rerun checks, push, and request current-head
   re-review as required. **Complete when:** required CI and review gates are
   green for the exact merge head.
8. **Merge and release.** Follow branch protection and repository release policy;
   do not treat merge as publication. Create or verify the version/tag/release and
   wait for deployment/indexing channels that the target contract names.
9. **Verify external state from source.** Read back the main-branch skill, release,
   and catalog. Run installer/CLI discovery against the published repository and
   confirm exact name, description, source URL/type, and version where exposed.
   Test an isolated install; do not rely on a preexisting local copy or redirect.
10. **Report staged completion.** Separate `verified`, `published`, `deferred`, and
    `out of scope`. A cache/index delay is pending, not failure or success. Name
    every explicitly requested external target and its independently verified
    state.

## Usage Examples

```text
Publish this Agent Skill to the current repository. Discover its conventions,
write contract tests first, validate and review the current head, then merge,
release, verify installer discovery and provenance, and report any indexing lag.
Do not touch any other repository, private plugin, marketplace, website, mirror,
sidecar, canonical/generated copy, or local-global installation unless I
explicitly name it.
```

```text
Publish this skill to the current public pack and also update the private plugin
repository I named. Treat those as separate targets, preview both scopes, verify
each release independently, and do not infer any additional mirror or sidecar.
```

## Pitfalls

- **Owner assumed from environment:** working credentials do not select a target.
- **Merge called release:** prove the tag/deploy/catalog and install path.
- **Branch copy called publication:** installer discovery must read the merged
  source, not an indexed feature branch or cache.
- **Silent external propagation:** mirrors, websites, private plugins, sidecars,
  and local-global installations require explicit user mention.
- **Root `SKILL.md`:** some installers stop discovery there; follow the target's
  actual multi-skill layout.
- **Description drift:** package README/catalog copy must match frontmatter where
  the target enforces it.
- **Review of stale head:** only current-head evidence satisfies the gate.
- **Local copy used as proof:** verify published source and isolated install.
- **Index cache ambiguity:** report the authoritative source separately from
  delayed third-party indexes.

## Verification

- [ ] Primary repository, owner, branch, layout, and release target were discovered.
- [ ] Tests failed before authoring and pass after implementation.
- [ ] Frontmatter, links, carried files, catalog, generators, and full checks pass.
- [ ] Required review is clean for the exact current head.
- [ ] Merge, release, and deployment/indexing states are reported separately.
- [ ] Main-branch source and release were read back.
- [ ] CLI discovery and isolated install report exact skill identity and provenance.
- [ ] Every user-mentioned external target has an independent verified state.
- [ ] No unmentioned private, external, mirror, website, sidecar, or local-global
      target was modified.
