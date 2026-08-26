# Public-release checklist

**Status:** v0.2.0 is a private implementation foundation. Completing this document does not publish the package, create a release, enable GitHub features, or submit a directory listing.

## Product readiness

- [x] Define the first supported deliverable: schema-v1 validator, projector, JSONL parser/journal, and adapter foundations.
- [ ] Move `package.json` from `private: true` only after an implementation and release owner are approved.
- [x] Set the current private semantic version and a changelog entry (`0.2.0`).
- [x] Document the implementation's Node.js baseline (`>=24.0.0`); document public support platforms, harness versions, and stability policy before publication.
- [x] Mark the Hermes module as adapter foundation; it is not Hermes Desktop core integration.
- [x] Add API documentation and deterministic examples; add separately runnable public-package examples before publication.

## Quality and security

- [x] Add lifecycle validation, projection, JSONL/journal, and Hermes adapter tests.
- [x] Define package policy, Markdown hygiene, type-checking, and test steps in `npm run verify` and Node 24 CI.
- [x] Obtain a passing `npm run verify` result from the final release candidate before publication.
- [x] Inspect the current `npm pack --dry-run` contents; the reviewed tarball contains declared package documentation, skills, and source, not journals, transcripts, credentials, or local artifacts.
- [x] Add package build plus clean tarball install/import verification to CI before publication.
- [x] Publish `SECURITY.md` with the intended v0.2.0 support posture, private-reporting route, and response targets.
- [ ] Enable and verify GitHub private vulnerability reporting before the repository becomes public; the repository security policy alone does not verify that reporting feature.
- [x] State a vulnerability-response target in `SECURITY.md`.
- [ ] Add a dependency update policy and provenance/signing policy before publication.
- [x] Verify all public-release documentation contains no private repository links, machine paths, tokens, customer data, or copied sensitive transcripts.

## Repository readiness

- [x] Add issue templates and a pull-request template.
- [x] Add `CODE_OF_CONDUCT.md` and a default `.github/CODEOWNERS` owner (`@crissmoldovan`) for the current private repository.
- [ ] Review and configure GitHub CODEOWNERS enforcement and a public maintainer/escalation roster before publication.
- [x] Add CI for Node 24.
- [ ] Add release automation only after permissions, provenance, and rollback behavior are reviewed.
- [x] Distinguish implemented foundations from unshipped host integrations in the roadmap and release notes.
- [x] Confirm the repository's original implementation is MIT-licensed and no bundled runtime dependency or copied third-party source requires additional attribution.

## Publication

- [ ] Reserve and verify the npm package name and organization ownership.
- [ ] Change package publication settings deliberately; do not rely on defaults.
- [ ] Create a signed/tagged public release and publish release notes.
- [ ] Verify the published tarball by installing it into a clean temporary project.
- [ ] Announce only after the public repository, package page, and security contact are live.

## Directory and ecosystem listings

- [x] Prepare a skills.sh-compatible skill and verify local repository discovery with the official `skills` CLI.
- [ ] Submit to skills.sh only after the repository is public and listing metadata is reviewed.
- [ ] Prepare a public OSS listing with the public repository URL, license, status, and maintainership details.
- [ ] Publish the listing only after a public release is available.

No public package release, npm publication, signed release, skills.sh submission, or OSS-listing submission has been verified from this repository.
