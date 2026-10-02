# Record shapes: what a transcript holds, and which records are a person's

The script and the procedure rest on the shapes below. Each claim is tagged:

- **OBSERVED**: read from real transcripts written by **Claude Code 2.1.224 to 2.1.286**, by a script
  that printed only record types, key names, enum values and counts, never content. The history read
  was one machine's: about 90 session transcripts and several thousand subagent transcripts.
- **DOCUMENTED**: stated by the harness's documentation, and not checked here.
- **NOT OBSERVED**: looked for and not seen, or not tried. The script still guards against it, and
  says how.

A harness version outside that range, or another harness, may write other shapes. Before trusting a
count on one, run `transcripts.mjs messages` and read the exclusions: a large `record:<type>` or
`attachment:<type>` kind the tables below do not name is a shape to look at first, with key names
and counts only.

## Where the transcripts are

| claim | tag |
|---|---|
| Session transcripts live at `~/.claude/projects/<encoded path>/<session id>.jsonl`, one JSON record per line. | OBSERVED |
| The encoded path is the absolute path with every character that is not an ASCII letter or digit replaced by a hyphen: a worktree at `<repo>/.claude/worktrees/feature` becomes `<encoded repo>--claude-worktrees-feature`. onboard-project's history scan uses the same rule, and the pack's suite holds the two encoders equal. | OBSERVED |
| The encoding is lossy: `/srv/example-repo` and `/srv/example/repo` share one directory name. | follows from the rule |
| A subagent writes its own transcript at `<session id>/subagents/agent-<id>.jsonl`, with an `agent-<id>.meta.json` beside it. A workflow's agents write theirs at `<session id>/subagents/workflows/<run id>/agent-<id>.jsonl`, beside a `journal.jsonl` that is the workflow's journal, not a transcript. | OBSERVED |
| A `tool-results/` folder beside the subagents holds large tool outputs as files. It is not a transcript and is not read. | OBSERVED |
| Each worktree, and each subdirectory a session was started in, gets a directory of its own. The harness keeps a worktree's directory after the worktree is removed. | OBSERVED |
| A session that enters a worktree part of the way through is filed under the worktree's directory, while its opening records carry the `cwd` of the checkout it started in. `worktree-state` records (`worktreeSession` with `originalCwd`, `worktreePath`, `worktreeBranch`) mark the move. | OBSERVED |
| A session's `cwd` changes as it works: one transcript held records with the checkout, two of its subdirectories and a worktree as `cwd`. | OBSERVED |
| Directory names up to 161 characters were seen. Whether the harness shortens a longer one was not seen. If `find` matches nothing, it lists directories whose names start the same way. | NOT OBSERVED |
| `cleanupPeriodDays` in Claude Code's settings sets how long transcripts are kept, 30 days by default. The machine read had raised it, so deletion was not seen there. | DOCUMENTED |

## Fields most records carry

`type`, `uuid`, `parentUuid`, `timestamp` (ISO 8601 in UTC, ending `Z`), `sessionId`, `cwd`,
`version` (the harness version that wrote the record), `gitBranch`, `entrypoint`, `isSidechain` and
`userType`. Some record types carry only a few of these: `last-prompt`, `ai-title` and
`queue-operation` have no `cwd`. (OBSERVED)

## The records that are a person's message

| kind | shape | tag |
|---|---|---|
| typed | `type: "user"`, `origin.kind: "human"`, and `message.content` as a string or an array of blocks; the words are the `text` blocks, and `image` or `document` blocks may sit beside them | OBSERVED from 2.1.234 |
| typed, no origin mark | the same, with no `origin` at all. On 2.1.224 no record carried an origin. On 2.1.258 a turn stored as a plain string carried none, while turns stored as arrays did. The script takes a user record with no origin when it is not in a subagent, not `isMeta`, not `isCompactSummary`, holds no `tool_result`, and is not harness markup, the interruption marker or a known harness preamble, and counts it as a fallback | OBSERVED |
| queued | `type: "attachment"`, `attachment.type: "queued_command"`, `attachment.commandMode: "prompt"`, the words in `attachment.prompt` (a string, or an array of blocks with `text` and sometimes `image`). Typed while a turn was running; it never appears as a user record | OBSERVED from 2.1.234 |
| queued, before 2.1.234 | The earliest version a `queued_command` record was seen on is 2.1.234. How 2.1.224 to 2.1.233 stored a message typed while a turn was running, in another shape or not at all, was not seen. A count over sessions those versions wrote may be short by every such message: read the `record:<type>` and `attachment:<type>` exclusions for one first | NOT OBSERVED |
| slash command arguments | `type: "user"`, no origin, content `<command-message>…</command-message>` `<command-name>/name</command-name>` `<command-args>…</command-args>`. The arguments are the person's words; the command's name is reported beside them | OBSERVED |

The harness's own mark is trusted. A turn marked `origin.kind: "human"`, or a queued prompt, is
the person's even when it is wholly markup, such as pasted HTML or XML, or opens with words a
harness preamble opens with ("Continue from where you left off."). Only the harness's own tags
(`command-`, `local-command-`, `bash-`, `system-reminder` and the others the script lists) and the
interruption marker are screened out of it. A turn with no mark rests on the fallback, so any text
that is wholly markup and every known preamble are screened out of it as well. (This is a guard,
not an observation: whether the history read holds marked turns of either kind was not checked.)

How much this matters, as anonymous facts from the history read: in one two-day session 157 of the
369 messages a person sent were queued; across all the sessions of one checkout, 127 of 542. A count
of user records alone would have missed every one of them.

## Records that are not, and the kind each is counted under

| kind counted | shape | tag |
|---|---|---|
| `tool-result` | `type: "user"` whose content holds a `tool_result` block. By far the most common user record | OBSERVED |
| `meta` | `isMeta: true` with no origin: an injected skill body, a check-in, a caveat, a note about an image | OBSERVED |
| `compact-summary` | `isCompactSummary: true`: the summary written when the context was compacted. It repeats the person's words, so a phrase is often found here as well | OBSERVED |
| `origin:task-notification` | a user record with `origin.kind: "task-notification"`: a background task or agent finished | OBSERVED |
| `queued:task-notification` | a `queued_command` with `commandMode: "task-notification"` | OBSERVED |
| `origin:peer` | `origin.kind: "peer"`, `isMeta: true`: a message from another agent session | OBSERVED |
| `origin:coordinator`, `queued:coordinator` | in a subagent's transcript: a coordinator's message, as a user record with `origin.kind: "coordinator"`, or as a `queued_command` with no `commandMode` whose `attachment.origin.kind` is `coordinator` | OBSERVED |
| `dispatch` | in a subagent's transcript, a user record with no origin: the prompt its parent or a script sent. `isSidechain: true` | OBSERVED |
| `headless` | a user record with no origin in a session whose `entrypoint` starts `sdk`: a prompt passed to a non-interactive run, written by a program or typed on a command line. Left out unless `--include-headless` | OBSERVED (`sdk-cli`) |
| `harness-markup` | a user record that is wholly markup, such as `<local-command-stdout>…</local-command-stdout>`, or a slash command with no arguments. On a turn marked human, only the harness's own tags count here | OBSERVED |
| `harness-markup` (shell mode) | `<bash-input>…</bash-input>`: a command the person ran in the harness's shell mode. It is theirs, but a command and not words to the agent, so it is counted here and not as a message | NOT OBSERVED |
| `interruption` | `[Request interrupted by user]` | OBSERVED |
| `harness-text` | a user record with no origin mark and no flag that opens with a known harness preamble ("This session is being continued from a previous conversation", "Caveat: The messages below were generated", and others the script lists). Every such preamble seen was flagged `isMeta` or `isCompactSummary`; the screen is a guard for one that is not, and never applies to a turn marked human | NOT OBSERVED unflagged |
| `attachment-only`, `queued:attachment-only` | a person's turn or queued prompt with an `image` or `document` block and no text: an image sent alone. Counted under its own kind and not as a message, since there are no words to locate, show or check; add it to a count of messages sent when images count as messages | NOT OBSERVED alone |
| `empty`, `queued:empty` | a user record or queued prompt with no text and nothing attached | guarded |
| `queue-bookkeeping` | `type: "queue-operation"` with `operation` `enqueue` (holding the text as `content`), `dequeue`, or `remove` (with `reason` `absorbed_mid_turn` or `delivered_to_agent`). It repeats a queued message; the delivered message is the `queued_command` | OBSERVED |
| `record:last-prompt` | `type: "last-prompt"` with `lastPrompt`: a copy of the latest prompt | OBSERVED |
| `record:<type>`, `attachment:<type>` | every other record: `assistant`, `system`, `ai-title`, `custom-title`, `mode`, `file-history-snapshot`, `worktree-state`, and attachments such as `file`, `edited_text_file`, `hook_success`, `skill_listing`, `total_tokens_reminder` | OBSERVED |
| `unparsable` | a line that is not JSON, such as a line cut off when a session ended. Counted, never fatal | guarded |

## Duplicates

| claim | tag |
|---|---|
| The same text is often sent more than once: as a typed turn and again as a queued message, minutes to days apart, and short messages such as "status?" many times. Each is a message, so nothing is deduplicated by text. | OBSERVED |
| One record (one `uuid`) in two transcripts. Not seen across about 1,900 typed turns. The script drops the second if it appears, counted as `duplicate-record`. | NOT OBSERVED |
| A person's message relayed into a subagent as a queued prompt. Not seen in the subagent transcripts read, where every queued prompt was a task notification or a coordinator's message. If one appears whose normalised text equals a message in its parent session, the script counts it once, at the parent, and the copy as `relayed-copy`. | NOT OBSERVED |
