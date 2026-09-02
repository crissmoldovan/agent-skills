---
name: blocks
description: "Interact with Blocks sessions, status, and bounded waits."
license: MIT
compatibility: "Blocks REST Sessions API or Blocks GitHub integration; direct sessions require a workspace-scoped API key, and GitHub status requires authenticated gh."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Grep Glob Bash
---

# Blocks interaction

Generic Blocks interaction primitives for other skills and workflows. This skill
owns workspace resolution, REST sessions, GitHub evidence collection, status
classification, and visible bounded waits. It does not own code-review policy,
fix findings, decide severity policy, or loop a PR to green; use the public
`request-blocks-review` skill for that workflow.

## When to Use

- “Ask Blocks,” “start a Blocks session,” “what is Blocks doing?”, or “await the
  Blocks response.”
- Another skill needs Blocks workspace/session/status/wait primitives.
- A caller needs to distinguish acknowledgement from terminal GitHub evidence.

## Workspace Resolution

Blocks REST credentials are workspace-scoped. Before a direct REST call:

1. Prefer a configured repository → workspace mapping.
2. Otherwise parse the workspace UUID after `/app/` from a Blocks workspace,
   settings, or session URL such as:

   ```text
   https://blocks.team/app/<workspace-id>/settings/api-keys
   ```

3. If neither yields exactly one workspace, ask the user to confirm a workspace
   URL or ID. Never choose whichever installed key happens to work.
4. Use a neutral local profile name. Credentials resolve from
   `BLOCKS_API_KEY_<PROFILE>` or, on macOS, Keychain service
   `blocks-api-key-<profile>`. Never print keys or pass them as CLI arguments.

## Direct REST Sessions

The documented base is `https://api.blocks.team/rest/v1`:

| Action | Endpoint/helper |
|---|---|
| Create | `POST /sessions` |
| Inspect | `GET /sessions/{id}` |
| Follow up | `POST /sessions/{id}/messages` |
| Wait | Poll returned `_links.final_message.href` |

A final-message page with empty `items` is pending. A non-empty assistant
`final_message` is terminal for that turn. Blocks documents no session status
enum, blocking wait endpoint, completion webhook, or GitHub-comment-to-session
mapping. Treat returned `_links` URLs as opaque and validate their official
origin/path/filter contract before use.

```bash
node skills/blocks/scripts/blocks-session-cli.mjs create \
  --profile <workspace-profile> --agent claude --message "..." \
  --wait --timeout 600
```

## GitHub Status

GitHub-originated review evidence remains GitHub-authoritative:

- top-level PR comments;
- formal reviews;
- all paginated inline review comments;
- PR open/closed state;
- Blocks dashboard links included in comments.

Always compare against a baseline containing timestamp and stable IDs. Help text,
eyes reactions, queue messages, and “taking a look” are nonterminal. Return one of
`requested`, `reviewing`, `clean`, `findings`, or `pr_closed`.

Blocks states completion in a top-level comment as often as in a formal review. A
post-baseline comment that names its own completion is terminal even when no review
was submitted; its wording then chooses the state — outstanding findings mean
`findings`, a fixed or empty finding list means `clean`. Acknowledgement wording
still wins: a comment that merely quotes the words a finished review would use
remains nonterminal, and so does a partial pass that makes the claim and then
withdraws it (“reviewed up to `packages/guards/` … I need another pass”).

**Completion is a past-tense claim, not a phrase.** Do not match a fixed list of
openers. This classifier once demanded the literal “reviewed PR” or “review
complete”, and a real verdict opening “Reviewed \`67b6d36\` and its
documentation-only diff” matched nothing — a caller waited forty minutes for a
verdict that had arrived in four seconds. Recognise the claim, then let two things
veto it: courtesy wording, and an admission of unfinished work.

**`clean` must be earned; ambiguity means `findings`.** A verdict is clean only when
it states its own emptiness — no/zero findings, `Findings: none`, a table row
reporting `0`, LGTM with nothing contrasted against it. A verdict that merely fails
to mention findings is **not** clean. The three ways to be wrong do not cost the
same: a false `findings` costs a reader the seconds it takes to open the comment, a
false nonterminal costs a timeout, and a false `clean` accepts an unreviewed or
unclean head — the only one of the three that merges. Bias every uncertain case away
from `clean`.

**Never decide from a bare mention.** “No new severity ≥7 findings” contains the
word `findings`; so does a `/findings` path segment in a dashboard URL, and so does
a quoted verdict from an earlier round that the next sentence retracts. Scope every
mention — negated, resolved, quoted, or outstanding — instead of testing whether the
noun appears. Watch for the inversion too: “zero of these findings have been
addressed” is the strongest possible findings statement and reads, to a naive
stripper, like the weakest.

```bash
node skills/blocks/scripts/blocks-review-cli.mjs status \
  --repo <owner/repo> --pr <N> --requested-at <ISO>
```

**A clean verdict is not acceptance.** `status` also reports whether the verdict can
actually be acted on, and refuses for a named reason when it cannot. Three things
must hold at once: the state is `clean`, the verdict covers the head under
consideration, and CI **succeeded on that same commit**.

Both halves were learned from real failures. A review names the commit it read
("Reviewed PR #29 at `a0eef8b`"); every push moves the branch, and a verdict for the
previous head says nothing about the current one while reading exactly like one that
does. Separately, `gh pr checks` reported pass while the run underneath belonged to
the previous head, because the new run had not registered yet — so **key CI on the
sha, never on the check name**. A run that has not finished is not a pass.

A verdict that names no commit is dated against the head rather than refused: one
posted after the head was committed cannot have read an earlier one. Refusing it for
its wording would be the same mistake one layer up.

## Visible Bounded Wait

Mirror Trigger.dev's active-wait contract, not its transport:

- keep one tracked operation active;
- surface waiting progress;
- combine caller cancellation with a hard deadline;
- stop on terminal evidence;
- return latest current state on timeout;
- propagate non-timeout failures.

Trigger.dev can subscribe to a run stream. Blocks REST and GitHub review status
use documented polling, so poll conservatively rather than busy-waiting.

## Usage Examples

```text
Resolve the Blocks workspace for this repository. If it is not uniquely known,
ask me for a workspace URL or ID. Start a session and visibly await its final
message for up to ten minutes.
```

```text
Get Blocks status for PR 42 against this request baseline. Include comments,
reviews, all inline comments, and distinguish acknowledgement from completion.
```

## Pitfalls

- Workspace key success does not prove it is the intended workspace.
- Dashboard URLs are not REST links; use only returned `_links` for API calls.
- Never send a follow-up merely to check status; follow-ups can interrupt work.
- Never silently hide a wait by redirecting all progress to a file.
- A timeout is nonterminal and must return current state explicitly.

## Verification

- [ ] Workspace resolved uniquely or the user was asked to confirm URL/ID.
- [ ] Credential profile is neutral and workspace-scoped.
- [ ] Returned REST links passed strict official URL validation.
- [ ] GitHub evidence uses timestamp plus stable-ID baseline and pagination.
- [ ] Wait is visible, cancellation-aware, and deadline-bounded.
- [ ] Timeout does not claim completion or failure.
