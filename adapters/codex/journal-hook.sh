#!/bin/sh
# Codex -> agent-journal. Never fails the call it observes: every path
# through this script exits 0, whether or not anything was actually
# recorded.
#
# UNVERIFIED. Codex is not installed on the machine that built this adapter
# (see ../NOTES.md, Step 4 -- checked and recorded, not skipped). Everything
# this script assumes about Codex's hook contract comes from OpenAI's
# published documentation (developers.openai.com/codex/hooks, mirrored at
# learn.chatgpt.com/docs/hooks, read 2026-09-08), never from a captured
# payload. See ../codex/README.md for exactly what is documented versus
# assumed, field by field. Nothing in this file has been run against a real
# Codex session. Treat it as a starting point to validate on a machine that
# has Codex installed, not as a tested integration.
#
# The actual event -> observation mapping lives in journal-hook.mjs, run as
# a Node script rather than in this file's own POSIX sh, for the same reason
# the Claude Code adapter does this (../claude-code/journal-hook.sh):
# tool_input/tool_response arrive as arbitrarily nested JSON, and parsing
# that in sh means depending on jq or python3 (neither guaranteed present)
# or hand-rolled parsing that breaks on the first embedded quote. Node is
# not a new dependency -- it is what `agent-journal` itself already needs to
# run.
#
# Configuration is environment variables, set INSIDE the hook `command`
# string -- Codex's documented hook handler fields (type, command, timeout,
# statusMessage, async, additionalContextLimit) carry no separate env block,
# same as Claude Code's. See ../hooks-fragment.json and ../README.md for the
# exact form:
#
#   AGENT_JOURNAL_WORKSPACE  required. Unset or blank: this script does
#                            nothing and exits 0 -- most sessions have not
#                            opted into the observation plane, and that is
#                            not an error condition.
#   AGENT_JOURNAL_CMD        the command that runs agent-journal, split on
#                            whitespace (no quoting support for an argument
#                            containing a space). Defaults to
#                            "agent-journal", which requires it on PATH.
#                            In a dev checkout, before that binary is
#                            installed anywhere, use:
#                              AGENT_JOURNAL_CMD="node /abs/path/to/packages/agent-journal/dist/bin.js"
#   AGENT_JOURNAL_NODE       overrides the `node` used to run
#                            journal-hook.mjs itself. Defaults to "node".
#                            Mainly for tests.
#   AGENT_JOURNAL_ROOT, AGENT_JOURNAL_SESSION, AGENT_JOURNAL_AGENT,
#   AGENT_JOURNAL_HARNESS    read by agent-journal itself, not this script.
#                            journal-hook.mjs additionally SETS
#                            AGENT_JOURNAL_SESSION (from the payload's own
#                            session_id, documented for every event) and,
#                            for SubagentStart/SubagentStop, AGENT_JOURNAL_AGENT
#                            from an assumed agent_id field -- see that
#                            file's comments on why that field name is a
#                            guess carried over from Claude Code's own
#                            naming, not a documented Codex field.
#
# The same pattern that does NOT belong here, verified live rather than
# assumed (see ../claude-code/journal-hook.sh for the original finding this
# repeats): `: "${AGENT_JOURNAL_WORKSPACE:?}" 2>/dev/null || exit 0` ends the
# whole non-interactive shell on an unset variable with ITS OWN nonzero exit
# code -- 1 under macOS's /bin/sh, 2 under dash -- before `||` ever runs.
# That is rule 1 broken on the single most common case. The `[ -z ... ]` form
# below was verified, under both /bin/sh and dash, to exit 0 instead --
# packages/agent-journal/test/adapter-codex.test.ts runs this file for real,
# the same discipline the brief requires: reading a script is not verifying
# it, running it is.
#
# One consideration specific to Codex, not present for Claude Code: its own
# documentation describes exit code 2 (with stderr text) on PreToolUse,
# PermissionRequest, Stop and SubagentStop as actively steering the harness
# -- blocking a tool call, denying a permission request, or forcing the
# agent to keep going instead of stopping. This script must never produce
# that exit code and must never write anything to its own stdout that Codex
# could parse as hook output, or "observing" a call could change its
# outcome, which is precisely what rule 1 forbids. Both are enforced below:
# the Node subprocess's own stdout/stderr are redirected to /dev/null before
# this script's own unconditional `exit 0`.
set -u

if [ -z "${AGENT_JOURNAL_WORKSPACE:-}" ]; then
  exit 0
fi

node_bin="${AGENT_JOURNAL_NODE:-node}"
if ! command -v "$node_bin" >/dev/null 2>&1; then
  exit 0
fi

dir=$(dirname "$0")

# stdin (the hook's JSON payload) is passed through untouched -- nothing in
# this script reads or redirects it before this line. Every failure mode
# inside journal-hook.mjs -- malformed JSON, an unmapped event, a missing or
# unwritable journal, agent-journal itself refusing the write -- is handled
# there and ends in that script's own exit 0; this line's exit status is
# deliberately ignored regardless. Redirecting the subprocess's own stdout
# to /dev/null is also what keeps this script from ever emitting anything
# Codex could read as hookSpecificOutput -- see the note above.
"$node_bin" "$dir/journal-hook.mjs" >/dev/null 2>&1

exit 0
