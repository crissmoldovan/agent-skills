# Enforcing clean-up in Claude Code and Codex

`scripts/setup-enforcement.mjs` installs two hooks. Both call one script, `leftovers.mjs`, which
setup copies to `$XDG_DATA_HOME/manage-workspace-storage/` (default `~/.local/share/...`) so the
hook entries keep working wherever the skill itself is installed or updated. Needs Node.js 22 or
newer. Makes no network request.

## Install, preview, remove

```bash
node scripts/setup-enforcement.mjs                 # preview: prints what would change, writes nothing
node scripts/setup-enforcement.mjs --yes           # install for every agent found
node scripts/setup-enforcement.mjs --agent codex --yes
node scripts/setup-enforcement.mjs status
node scripts/setup-enforcement.mjs uninstall --yes # removes only the entries and the copy this wrote
node scripts/setup-enforcement.mjs uninstall --purge --yes   # also removes session state and the mode
```

Run from the installed skill folder. It is idempotent: a second run reports "already up to date" and
rewrites nothing; after a skill update, run it again to refresh the copy.

| Agent | File edited | Found by |
| --- | --- | --- |
| Claude Code | `settings.json` in `$CLAUDE_CONFIG_DIR` or `~/.claude` | the folder exists |
| Codex | `hooks.json` in `$CODEX_HOME` or `~/.codex` | the folder exists |

Existing hooks are never removed, reordered or rewritten: the two entries are appended, and an
uninstall removes only entries whose command runs this script. Before the first write to a file,
the previous bytes are copied beside it as `<file>.bak-manage-workspace-storage` (a timestamp is
added if that name exists). A file that is not valid JSON is left alone and setup stops.

Codex runs a hook only after it has been reviewed: after installing, open `/hooks` in Codex and
trust the two new entries. Claude Code runs them from the next session; running sessions keep the
hooks they started with.

## The two hooks

| Event | Matcher | What it does |
| --- | --- | --- |
| `SessionStart` | `startup\|resume\|clear\|compact` | Adds the clean-up policy to the session's context, with the session id and the `note`, `keep` and `done` commands. |
| `Stop` | none (ends each agent turn) | Lists what this session created and still left. Silent when nothing is. |

### What the end-of-turn check looks at

It never scans the machine. It reads this session's transcript (`transcript_path` in the hook
input) from where it stopped last time, so each turn costs only the new lines, and collects what
the session's own commands created:

- `git worktree add` (anywhere), checked by the path still existing;
- `docker run` or `create` with `--name` (not a `--rm` foreground run), and `docker compose up`,
  checked against `docker ps -a` and `docker compose ls`;
- `tart clone`, `create` and `run`, checked against `tart list` (a VM only run, not created, counts
  only while it is running);
- folders and files created under temporary folders (`/tmp`, `/var/tmp`, `/var/folders`), the
  `Shared` user folder, `~/Library/Caches` and `~/.cache`, by `mkdir`, `touch`, `cp`, `mv`,
  `rsync`, `ditto`, `curl -o`, `wget`, `tar -C`, `unzip -d`, `git clone`, `screencapture`, `tee`, a
  `>` redirect, `hdiutil create`, a `Write` tool call, or a `--cache`, `--cache-dir` or `*CACHE*=`
  setting;
- anything the session recorded with `note`.

An item counts only if it exists now and, for paths, was created after the session began, so
another session's or an older item is never flagged. The harness's own per-session scratch folder
is ignored. A query is capped at about a second in total; if Docker or Tart is not running, those
items are skipped.

Limits, stated plainly: this reads commands, not effects. A script that creates a folder, a
container started without `--name`, a cache folder a tool picks for itself, and a signed-in
configuration are invisible to it unless the agent runs `note`. It shows a reminder; it does not
remove anything.

### The ledger

```bash
node "$XDG_DATA_HOME/manage-workspace-storage/leftovers.mjs" note --session <id> --kind worktree --path <path> --purpose "<why>" --until "<when>"
node ".../leftovers.mjs" keep --session <id> --path <path> --reason "<why it stays>"
node ".../leftovers.mjs" done --session <id> --path <path>
node ".../leftovers.mjs" list --session <id> --transcript <file>
```

`kind` is `path`, `worktree`, `container`, `vm`, `credential` or `other`. A noted path, worktree,
container or VM is flagged while it exists; a noted `credential` or `other` is flagged until `done`
or `keep`. A kept item is not flagged again.

## Modes: the blocking switch

| Mode | Stop hook output | Effect |
| --- | --- | --- |
| `warn` (default) | `{"systemMessage": "..."}` | A reminder shown to the person, once per distinct set of leftovers. The model does not see it. |
| `block` | `{"decision": "block", "reason": "..."}` | The turn does not end; the model is told what is left and must remove it or `keep` it with a reason, then say what it left and removed. Once per distinct set, and never when `stop_hook_active` is true, so it cannot loop. |
| `off` | nothing | Both hooks are silent. |

```bash
node scripts/setup-enforcement.mjs mode block --yes     # persists in $XDG_CONFIG_HOME/manage-workspace-storage/mode
MWS_CLEANUP_MODE=block                                  # the environment overrides the file for one process
```

## Contracts relied on

Taken from the Codex hooks documentation (read 2026-11-22), with the field names checked against the
`codex-cli 0.171.0` binary, and from the Claude Code hooks contract. Not yet observed end to end in a
live Stop turn: the tests drive both hooks with synthetic payloads in each harness's shape. Re-check
if a harness changes.

- Both pass one JSON object on stdin with `session_id`, `transcript_path`, `cwd` and
  `hook_event_name`; `Stop` adds `stop_hook_active`.
- Both accept, on exit 0, `{"decision": "block", "reason": ...}` from `Stop` to continue the turn,
  and `{"systemMessage": ...}` as a message to the person. Plain stdout is invalid for `Stop` in
  Codex, so the hook always prints JSON or nothing.
- Both accept `{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": ...}}`
  from `SessionStart`.
- Claude Code's transcript is JSONL with `tool_use` blocks in `assistant` messages; Codex's rollout
  is JSONL with `response_item` entries of type `function_call`, `custom_tool_call` or
  `local_shell_call`. Codex documents its transcript format as not stable; the reader skips lines it
  does not recognise and a hook failure never fails the session (every path exits 0).
- Codex hook timeouts are in seconds; the entries use 10.
