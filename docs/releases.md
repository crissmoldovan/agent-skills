# Releases

## Published catalog

This public catalog ships exactly two skills: `model-routing` and `agent-lifecycle`. Their composition is documented in [the two-skill composition guide](composition.md); neither is a scaffold or placeholder for a third coordinator skill.

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
