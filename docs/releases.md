# Releases

## Published catalog

This public catalog ships `model-routing`, `agent-lifecycle`, and `blocks`, plus
the canonical lifecycle runtime package under
`packages/agent-lifecycle`. Their composition is documented in [the two-skill
composition guide](composition.md). `blocks` is independent review tooling, not
a routed-delegation coordinator.

## Release checklist

1. Confirm every new or changed skill is under `skills/<name>/SKILL.md`.
2. Run `npm run verify` with Node.js 24 or newer.
3. Review all content against the [public-content policy](public-content-policy.md).
4. Confirm README catalog language still names exactly the intended published skills.
5. Merge through a reviewed pull request after CI succeeds.
6. Tag and publish the release using the project release process.

## Versioning

The repository version records public catalog releases. Version and release notes must describe user-visible behavior for both shipped skills when affected.

## Changelog

Maintain release notes in GitHub Releases. Notes must explain end-user behavior, not only internal implementation changes.

Future publication work is tracked in the [roadmap](roadmap.md); roadmap items
must not be described as shipped release behavior until implemented and
verified.
