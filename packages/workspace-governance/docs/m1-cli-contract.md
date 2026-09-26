# v0.2 M1 CLI and local-install contract

This document pins milestone M1/A02. It does not define the v2 catalog, editing,
workspace-operation, or workflow-execution interfaces scheduled for later milestones.

## Command shell

- Package and binary remain `@crissmoldovan/workspace-governance` and
  `workspacectl`; both report version `0.2.0` and require Node.js 24 or newer.
- No arguments, `help`, and `--help` print the same text and exit 0. `version` and
  `--version` print `0.2.0` and exit 0.
- Help lists `doctor` as the only v0.2 setup command. Preserved v0.1 read-only
  commands are grouped and labelled **Legacy read-only engine**. It says their
  principal is advisory and their workflow data is inert. It does not list the
  removed native init-trial, controller, ledger, recovery, or mutation-status
  commands and does not advertise later organizer/edit/apply/execution commands.
- A removed or unknown command fails as `UNSUPPORTED`, exit 2. Text error output is
  the default; adding `--json` emits exactly the public JSON error envelope
  `{ "ok": false, "error": { "code", "message", "details"? } }`.
- All successful data commands use readable text by default and accept `--json` for
  the full machine result. Preserved v0.1 read-only semantics and safety checks stay
  intact, but their former JSON-by-default formatting is intentionally replaced by
  the v0.2 shell. `report --format html` remains an explicit alternate rendering.

## Doctor

Invocation: `workspacectl doctor [--standalone] [--config FILE] [--skill FILE] [--json]`.
Duplicate, unknown, empty, or positional doctor arguments fail without probing.
`--standalone` and explicit `--skill` are mutually exclusive and refuse before any
prerequisite probe.

Configuration selection is deterministic: `--config`, then
`WORKSPACECTL_CONFIG`, then `$XDG_CONFIG_HOME/workspacectl/config.yaml`, then
`$HOME/.config/workspacectl/config.yaml`. Skill selection is `--skill`, then
`WORKSPACECTL_SKILL`, then `$HOME/.hermes/skills/workspace-governance/SKILL.md`.
No other directories are searched. The default mode reports `readinessScope:"integration"`
and means **CLI + agent skill integration**; an explicit `--skill` may point to a
matching reviewed integration for Codex or another supported agent, while the default
fallback remains unchanged.

With `--standalone`, doctor reports `readinessScope:"standalone"`, sets
`selected.skill` to null, and emits a `skill` check with `status:"skipped"` and
`required:false`. It does not select or read a skill path and ignores
`WORKSPACECTL_SKILL`.

Doctor actually checks the running Node version, installed CLI version/path or source
route, trusted Git availability, selected config schema, trusted roots, selected store
adapters, and current readable catalog/local state. Integrated mode also checks the
selected skill frontmatter version. It never writes.

- Missing config: `NOT_CONFIGURED`, exit 2, with the selected path and a create/init
  remedy that does not claim init already exists.
- Invalid/unreadable/non-file config: `INVALID_CONFIG`, exit 2.
- Missing Git: `ACTION_FAILED`, exit 6, with a separate install remedy.
- Invalid installation receipts: `INCOMPLETE`, exit 3, in either readiness scope.
- Missing or mismatched skill is included as an `INCOMPLETE` check and remedy only
  for CLI + agent skill integration readiness.
- A valid selected setup may return ready in standalone mode without a skill; this
  establishes CLI readiness only, not agent integration readiness.

Default text and `--json` describe the same checks, selected sources, overall code,
and remedies. JSON uses `{ok:false, command:"doctor", ready:false, ... , error}`.
A completed diagnosis is written to stdout even when its readiness exit is nonzero;
malformed invocation or a failed probe uses the normal stderr error channel.

## Isolated local installation

Run the reviewed checkout's `scripts/install-local.sh` with three absolute paths:

```sh
scripts/install-local.sh --archive PACKAGE.tgz \
  --prefix "$HOME/.local/share/workspacectl/versions/0.2.0" \
  --launcher "$HOME/.local/bin/workspacectl"
```

The prefix basename must be `0.2.0`. The bootstrap selects an exact Node.js 24+
runtime from `PATH`, requires trusted `git` and `npm`, and never installs them.
It installs the packed candidate with lifecycle scripts disabled, verifies package
name/version/CLI, records the selected runtime, and writes a stable shell launcher.
The launcher uses that exact runtime and emits an actionable error if it disappears.
Paths with spaces are supported.

The version prefix must be absent. An absent launcher is created; an existing
regular launcher is replaced only when it carries the installer-owned marker.
Symlinks, directories, and unrelated occupied files are refused before package
installation. No global runtime, config, skill, credential, provider, or Hermes
setting is changed. Skill installation remains a separate explicit action.
