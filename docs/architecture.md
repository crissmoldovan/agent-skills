# Architecture

## Purpose

`agent-skills` is a public, standards-first monorepo for portable agent skills. It separates catalog structure and validation from the skill content shipped by the public catalog.

## Discovery contract

The only supported discovery location is:

```text
skills/<name>/SKILL.md
```

`<name>` is the skill's stable identifier. Its `SKILL.md` frontmatter must declare the same `name`. The repository must not contain a root-level `SKILL.md`; that layout can make generic skill installers stop discovery early and ignore nested skills.

## Initial catalog boundary

The public product starts with exactly two planned skills:

- `model-routing`: exact model and profile selection for agent tiers.
- `agent-lifecycle`: automatic delegated-work visibility.

No third skill belongs in the initial catalog without a deliberate product decision.

## Verification boundary

`scripts/verify-skills.mjs` is dependency-free and is run locally and in CI. It enforces discovery structure, minimal frontmatter, local-link containment, likely-secret detection, and local absolute-path detection. It intentionally does not claim to prove that content is safe; human review and the [public-content policy](public-content-policy.md) remain required.

## Automation

GitHub Actions runs the same verifier using Node.js 24. Dependabot maintains GitHub Actions updates. CODEOWNERS routes changes in policy, automation, and skill content to maintainers.
