# Architecture

## Purpose

`agent-skills` is a public, standards-first monorepo for portable agent skills. It separates catalog structure and validation from the skill content shipped by the public catalog.

## Discovery contract

The only supported discovery location is:

```text
skills/<name>/SKILL.md
```

`<name>` is the skill's stable identifier. Its `SKILL.md` frontmatter must declare the same `name`. The repository must not contain a root-level `SKILL.md`; that layout can make generic skill installers stop discovery early and ignore nested skills.

## Catalog boundary

The public product started with exactly two planned skills:

- `model-routing`: token-efficient, quality-preserving work routing with exact model bindings.
- `agent-lifecycle`: automatic delegated-work visibility.

No further skill belongs in the catalog without a deliberate product decision. The catalog
now ships seventeen skills, each admitted by such a decision and each recorded in the
repository README and in [releases](releases.md).

## Verification boundary

`scripts/verify-skills.mjs` is dependency-free and is run locally and in CI. It enforces discovery structure, minimal frontmatter, local-link containment, carried-file existence for every bare `references/`, `scripts/`, or `assets/` token, a 484-line cap on the `SKILL.md` body so detail lives in carried files, likely-secret detection, and local absolute-path detection. It intentionally does not claim to prove that content is safe; human review and the [public-content policy](public-content-policy.md) remain required.

## Automation

GitHub Actions runs the same verifier using Node.js 24. Dependabot maintains GitHub Actions updates. CODEOWNERS routes changes in policy, automation, and skill content to maintainers.

## Future architecture

The planned bridge from the private CUE++ skills control plane to this public
delivery repository is documented in the [roadmap](roadmap.md). The public
repository remains independently installable and contains no private team state.
