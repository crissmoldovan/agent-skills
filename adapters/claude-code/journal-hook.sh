#!/bin/sh
# Claude Code -> agent-journal. Never fails the call it observes: every path
# through this script exits 0, whether or not anything was actually
# recorded. See ../NOTES.md for the payload shapes and event names this
# adapter parses -- it was produced by capturing real hook payloads rather
# than guessing, and it outranks this file, ../README.md, or anyone's
# recollection of how Claude Code hooks behave if they ever disagree.
#
# The actual event -> observation mapping lives in journal-hook.mjs, run as
# a Node script rather than in this file's own POSIX sh: several payload
# fields (tool_input, tool_response) arrive as arbitrarily nested JSON, and
# parsing that correctly in sh means depending on jq or python3 (neither
# guaranteed present) or hand-rolled parsing that breaks on the first
# embedded quote. Node is not a new dependency here -- it is what
# `agent-journal` itself already needs to run.
#
# Configuration is environment variables. Claude Code's hook `command` is a
# single string with no documented way to attach a separate env block (see
# ../NOTES.md, Step 1), so set these INSIDE that command string -- see
# ../settings-fragment.json and ../README.md for the exact form:
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
#                            session_id) and, for SubagentStart/Stop,
#                            AGENT_JOURNAL_AGENT (from agent_id) on the
#                            child process it spawns -- see that file.
#
# A note on a pattern that looks like it belongs here and does not:
# `: "${AGENT_JOURNAL_WORKSPACE:?}" 2>/dev/null || exit 0` was the sketch
# this file started from. Measured directly: on an unset variable, `${:?}`
# ends the whole (non-interactive) shell right there, with ITS OWN nonzero
# code -- 1 under macOS's /bin/sh, 2 under dash -- before the `||` ever runs.
# That violates rule 1 outright (this script exiting 1 or 2 on the single
# most common case, an unconfigured workspace, is precisely a hook that can
# fail the call it observes). The `[ -z ... ]` form below was verified,
# under both /bin/sh and dash, to exit 0 in that case.
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
# deliberately ignored regardless.
"$node_bin" "$dir/journal-hook.mjs" >/dev/null 2>&1

exit 0
