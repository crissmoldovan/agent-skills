# @crissmoldovan/agent-journal

Append-only decision journal for coding agents. Implements the schema-v1 envelope,
value-level redaction, workspace identity, projection with retraction, retention with
anchor pinning, and a CLI.

See the design spec at `docs/superpowers/specs/2026-09-07-agent-decision-journal-design.md`.

## Status

Core package only. Harness adapters, the digest renderer and the `decision-journal`
skill are covered by a second plan.

## Development

Requires Node.js 22.7 or newer. Run `npm install` then `npm run verify`. The floor is
22.7 and not 22.0 because `npm test` runs the TypeScript sources under
`--experimental-strip-types`, and v22.6.0 strips `readonly #field` into a SyntaxError
before a single test executes.

The CLI built from these sources has a lower floor — major 22, exercised from v22.0.0 —
because what the `decision-journal` skill ships is the bundled JavaScript, which never
meets the type stripper. That number is stated in
`skills/decision-journal/scripts/install-cli.mjs`, and the esbuild target in
`scripts/bundle-skill.mjs` must not sit above it. The repository's own `npm run verify`
is a third question again and still needs Node.js 24.
