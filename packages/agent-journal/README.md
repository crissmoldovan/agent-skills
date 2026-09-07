# @crissmoldovan/agent-journal

Append-only decision journal for coding agents. Implements the schema-v1 envelope,
value-level redaction, workspace identity, projection with retraction, retention with
anchor pinning, and a CLI.

See the design spec at `docs/superpowers/specs/2026-09-07-agent-decision-journal-design.md`.

## Status

Core package only. Harness adapters, the digest renderer and the `decision-journal`
skill are covered by a second plan.

## Development

Requires Node.js 24 or newer. Run `npm install` then `npm run verify`.
