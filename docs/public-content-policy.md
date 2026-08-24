# Public Content Policy

This is a public repository. Every committed byte must be safe to redistribute without access controls.

## Allowed

- general, reusable agent workflows;
- public documentation and public URLs;
- examples using clearly fake values such as `example.com` and `YOUR_TOKEN`;
- portable commands that a contributor can understand and safely adapt.

## Prohibited

Do not commit:

- credentials, tokens, cookies, private keys, or connection strings;
- customer, employee, or private operational data;
- internal-only URLs, hostnames, repositories, issue links, or runbooks;
- absolute paths that identify a developer or machine; or
- instructions that bypass authorization, logging, safety controls, or review.

## Review standard

Treat examples as executable guidance. A reviewer must be able to conclude that the content is public, portable, and safe before it is merged. The automated validator catches common secret patterns and absolute paths, but it is a backstop—not a substitute for review.

If content might be sensitive, do not commit it. Ask a maintainer for a safe public abstraction or report an accidental disclosure using [SECURITY.md](../SECURITY.md).
