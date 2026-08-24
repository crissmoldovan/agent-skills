# Security Policy

## Supported versions

| Version | Support status | Security fixes |
| --- | --- | --- |
| `0.2.0` | Current stable implementation foundation | Supported after its public release; fixes will be made in the next supported release when feasible. |
| Earlier versions | Unsupported | No security fixes are promised. |
| Unreleased `main` | Development only | Do not rely on it for production security support. |

`@crissmoldovan/agent-lifecycle` is developed in the public
`crissmoldovan/agent-skills` repository. No public npm release is implied by
the source package or GitHub release.

## Reporting a vulnerability

Please **do not** open a public issue for a suspected vulnerability or include credentials, access tokens, production data, private transcripts, or sensitive session data in a report.

After maintainers enable and verify the repository's **Report a vulnerability** flow in the Security tab, use that flow to submit a private report. The repository currently has a published GitHub security policy, but that policy alone does not verify that private vulnerability reporting is enabled. Before the repository becomes public, maintainers must enable and test that reporting path and publish a reviewed escalation contact. Until then, if the private-reporting flow is unavailable, do not disclose the vulnerability publicly; contact a project maintainer only through a private channel you already have and request a secure reporting route.

Include:

- a clear description of the issue and its impact;
- the affected package version, commit, file, or configuration;
- reproducible steps or a minimal, sanitized proof of concept;
- any known mitigations or suggested fixes; and
- whether you believe the issue has already been disclosed.

## Response and disclosure targets

For a supported public release, maintainers aim to:

1. acknowledge a valid report within **5 business days**;
2. provide an initial assessment or status update within **10 business days**;
3. coordinate a fix, release, and disclosure timeline with the reporter; and
4. publish a security advisory or release note after a fix is available, unless coordinated disclosure requires a different timeline.

These are targets, not guarantees. Severity, reproducibility, affected users, and maintainer availability can change the timeline. Please allow reasonable time for triage and remediation before public disclosure.

## Scope and handling guidance

The implementation may process local agent transcripts, event journals, session identifiers, and diagnostics. Treat these as potentially sensitive. Public contributions and reports must not add real transcripts, private endpoints, credentials, machine-specific paths, customer data, or unredacted production logs to the repository.

Security reports about the repository's source, published package contents, documented adapters, or release artifacts are in scope. Reports about third-party harnesses, GitHub, npm, or local environments are out of scope unless this project directly causes the issue.
