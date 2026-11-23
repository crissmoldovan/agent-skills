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

An agent asked to install or update the skill does this, with the Skills CLI first, in the order the
skill's [Install or update (agents)](../SKILL.md#install-or-update-agents) section gives.

| Agent | File edited | Found by |
| --- | --- | --- |
| Claude Code | `settings.json` in `$CLAUDE_CONFIG_DIR` or `~/.claude` | the folder exists |
| Codex | `hooks.json` in `$CODEX_HOME` or `~/.codex` | the folder exists |

Existing hooks are never removed, reordered or rewritten: the two entries are appended, and an
uninstall removes only entries whose command runs this script. Before the first write to a file,
the previous bytes are copied beside it as `<file>.bak-manage-workspace-storage` (a timestamp is
added if that name exists). A file that is not valid JSON is left alone and setup stops.

Claude Code runs the hooks from the next session; running sessions keep the hooks they started with.
Codex runs a hook only after it has been reviewed and trusted, which is a separate step: see
[Trusting the hooks in Codex](#trusting-the-hooks-in-codex).

## Trusting the hooks in Codex

Codex does not run a hook it has not been told to trust, so after setup the two new entries (one
`SessionStart`, one `Stop`, both running `leftovers.mjs`) sit idle until they are trusted.

**Trust is per machine.** Codex keeps it in that machine's `~/.codex/config.toml`, so it has to be
done on every Mac or Linux box the hooks are installed on. It also has to be **done again whenever a
hook's command changes**, because Codex then shows the entry as new. The command embeds the path of the
`node` that ran setup and the path of the script copy, so a moved Node.js or a different data folder
changes it; a plain skill update that only refreshes the script copy does not. Setup prints
`update ... entry` when it rewrites a command, and that is the signal to trust again.

Codex stores the trust as a table named for the hook's position, with a hash of what it reviewed:

```toml
[hooks.state."<absolute path of hooks.json>:<event in snake_case>:<group index>:<hook index>"]
trusted_hash = "sha256:<hex>"
```

`node scripts/setup-enforcement.mjs status` reads those tables and prints `Codex trust: SessionStart
trusted; Stop trusted` (or `not trusted`). It can only see that a hash is stored, not that it matches
the current command, so after a command change `/hooks` is the authority.

### Default: the person reviews in `/hooks`

1. Ask the person to open Codex and run `/hooks`.
2. They press `t` on the new `manage-workspace-storage` entries: one `SessionStart`, one `Stop`.
3. Verify by reading back: `setup-enforcement.mjs status` shows both as trusted, and
   `~/.codex/config.toml` has a `trusted_hash` under each of the two hook keys.

An agent must not skip the review, and must say plainly that the hooks are not active until it is done.

### Guarded self-approval

Opt-in. Use this only when the person's request **explicitly authorises self-approval** of these hooks, for
example "install it and approve the Codex hooks yourself". Without that sentence, use `/hooks`.

Say the trade-off before doing it, and keep it in the report. Self-approval **bypasses Codex's review
step**: the person does not look at the hooks before they run. It is for the **machine owner's own
setup**, never for someone else's machine, a shared one, or a hook the person has not asked for. It
relies on how Codex fingerprints a hook, which is internal and not a documented interface, so **a
Codex update can break it**, and a wrong write would make Codex list the hooks as needing review again
(the safe failure) or, worse, trust something it should not. That is why every step below can stop
the procedure and hand back to `/hooks`.

1. **Scope.** Find exactly the two manage-workspace-storage hooks in `hooks.json`: `SessionStart`
   running `leftovers.mjs session-start`, and `Stop` running `leftovers.mjs stop`. Nothing else. Stop
   if either is missing, or does more than run that script.
2. **Back up** `config.toml` beside itself. Never read `auth.json` or any credential.
3. **Derive the fingerprint method from Codex's open source** (github.com/openai/codex), at the tag of
   the installed version (`codex --version`). A plain sha256 of the command string, or of the hook's
   JSON, is not assumed to be it: on the machine this was tested on, neither matched. Then **prove**
   the method on a hook the owner already trusted through `/hooks`: it must reproduce the stored
   `trusted_hash` as an **exact match**. If there is no exact match, or no already-trusted hook to
   test against, stop and hand back to `/hooks`. Never write an unproven value.
4. **Write only the two entries**, in the existing form of the file, under the two keys for those hooks.
5. **Verify.** The file differs from the backup only by those two entries, and Codex itself no longer
   lists them as needing review (use whatever the installed Codex offers to list hooks and their
   review state, a non-interactive listing if it has one, otherwise ask the person to open `/hooks`;
   the file alone is not proof). Otherwise restore the backup and hand back to `/hooks`.
6. **Report** the Codex version, the method (source file and function), the proof (which trusted hook
   matched), the two entries written and the backup path.

Never use `--dangerously-bypass-hook-trust`, never edit `hooks.json` to make a hook look trusted, and
never trust any other hook, whatever it is.

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
