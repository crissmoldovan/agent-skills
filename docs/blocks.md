# Blocks reviews

The `blocks` skill is the final code-review loop after implementation and local
verification on a GitHub PR are finished. It requests review, visibly awaits a
real verdict, fixes and verifies findings, then requests re-review until the
current PR head is green.

## Supported integration

The supported evidence surface is GitHub:

- PR issue comments;
- formal pull-request reviews;
- inline review comments;
- PR open/closed state; and
- Blocks dashboard links included in comments.

Blocks documents a REST Sessions API at `https://api.blocks.team/rest/v1`.
With a profile-scoped key such as `BLOCKS_API_KEY_PERSONAL` or another
user-chosen `BLOCKS_API_KEY_<PROFILE>`, the skill can create or inspect sessions, send follow-ups,
and poll the opaque final-message URL returned by the API. The API does not
document a session status enum: completion for a turn means the filtered final
message page has a non-empty `items` array. GitHub review requests remain a
separate path because Blocks does not document a public mapping from a GitHub
comment to a REST session ID.

Before a direct REST call, resolve the workspace from a known repository mapping
or a Blocks URL such as `https://blocks.team/app/<workspace-id>/settings/api-keys`.
If neither yields one unique workspace, ask the user to confirm the workspace
URL or ID; never guess from whichever key happens to be installed.

## Status and wait

```bash
node skills/blocks/scripts/blocks-review-cli.mjs status \
  --repo owner/repository --pr 17 \
  --requested-at 2026-08-24T23:44:13Z
```

```bash
node skills/blocks/scripts/blocks-review-cli.mjs wait \
  --repo owner/repository --pr 17 \
  --requested-at 2026-08-24T23:44:13Z \
  --timeout 600 --interval 15
```

Possible states are:

| State | Meaning |
|---|---|
| `requested` | Request exists; no later Blocks activity proves work started. |
| `reviewing` | Blocks acknowledged/queued/started, but no terminal review exists. |
| `clean` | Blocks posted a clean review or clean terminal summary. |
| `findings` | A substantive review or inline finding exists. |
| `pr_closed` | The PR closed before a terminal Blocks review was observed. |

The wait helper adapts Trigger.dev's open-source
`wait_for_run_to_complete` design: repeatedly observe current state, stop when
terminal, honour timeout/cancellation, and return the current state on timeout.
Trigger.dev can subscribe to a run stream; GitHub exposes no equivalent Blocks
subscription, so this helper uses conservative polling of authenticated GitHub
APIs.

## Direct REST sessions

```bash
node skills/blocks/scripts/blocks-session-cli.mjs create --profile <workspace-profile> \
  --agent claude --message "Review this architecture" --wait --timeout 600
```

```bash
node skills/blocks/scripts/blocks-session-cli.mjs get --profile <workspace-profile> --session <uuid>
node skills/blocks/scripts/blocks-session-cli.mjs follow-up \
  --profile <workspace-profile> --session <uuid> --message "Focus on security" --wait
```

Create and follow-up responses carry their own `_links.final_message.href`.
Poll that exact URL; do not construct dashboard-derived endpoints. Follow-ups
interrupt an in-flight turn, so they require explicit intent and are not a
status-check mechanism.

## Example

```text
Ask Blocks to review this branch's PR and await up to ten minutes. Report
requested, reviewing, clean, or findings. Include inline findings and the
Blocks dashboard session link if posted.
```
