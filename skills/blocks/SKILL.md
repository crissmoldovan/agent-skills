---
name: blocks
description: "Request and await Blocks reviews on GitHub PRs."
license: MIT
compatibility: "GitHub pull requests with the Blocks integration installed; requires an authenticated GitHub CLI for status and wait operations."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Grep Glob Bash
---

# Blocks reviews

Use Blocks as the final code-review gate after implementation and local
verification are complete on a GitHub pull request. Request the review,
distinguish acknowledgement from real review, await completion visibly, fix and
verify findings, then re-run Blocks until the current PR head is clean.

Blocks also provides an official REST Sessions API at
`https://api.blocks.team/rest/v1`, authenticated by a workspace-scoped API key.
It can create/inspect sessions, send follow-ups, and poll the
opaque `_links.final_message.href` until the assistant's final message exists.
It does not document a session status enum, blocking wait endpoint, completion
webhook, or session-list endpoint. GitHub-originated review status still comes
from GitHub because no public comment-to-session-ID mapping is documented.

## When to Use

- Implementation and local verification on a GitHub PR are finished and the PR
  needs its final Blocks review/fix/re-review gate.
- “Ask Blocks,” “Blocks review,” “what is Blocks doing?”, or “await the review.”
- Blocks posted findings that need severity triage and verification.
- A user wants to ask Blocks a question on a GitHub PR.

Don't use for local-only review, a repository without the Blocks GitHub
integration, or direct Blocks dashboard automation.

## Prerequisites

1. Resolve the pull request and confirm it is open.
2. Confirm `gh auth status` succeeds for its repository.
3. Confirm the Blocks integration is present. A generic Blocks help comment
   proves installation, but it is not a completed review.
4. Record a baseline before every request: current comment/review IDs and the
   request timestamp. **Complete when:** later status ignores older evidence.
5. Resolve the Blocks workspace before direct REST use. Prefer a configured
   repository → workspace mapping; otherwise parse the UUID after `/app/` from a
   Blocks workspace/settings/session URL. If no unique workspace is known, ask
   the user to confirm a workspace URL or ID. Never silently choose a key.
6. Obtain one API key per workspace from Blocks Settings → API Keys. Choose a
   neutral local profile; store it as `BLOCKS_API_KEY_<PROFILE>` or, on macOS,
   Keychain service
   `blocks-api-key-<profile>`. Never print it or pass it as a CLI argument.

## Quick Reference

| Action | Command or comment |
|---|---|
| Request review | `gh pr comment <PR> --repo <owner/repo> --body "@blocks please review"` |
| Ask a question | `gh pr comment <PR> --repo <owner/repo> --body "@blocks <question>"` |
| Status | `node skills/blocks/scripts/blocks-review-cli.mjs status --repo <owner/repo> --pr <N> --requested-at <ISO>` |
| Bounded wait | `node skills/blocks/scripts/blocks-review-cli.mjs wait --repo <owner/repo> --pr <N> --requested-at <ISO> --timeout 600 --interval 15` |
| Re-review | `gh pr comment <PR> --repo <owner/repo> --body "@blocks I've addressed the findings — please re-review."` |
| Create REST session and wait | `node skills/blocks/scripts/blocks-session-cli.mjs create --profile <workspace-profile> --agent claude --message "..." --wait --timeout 600` |
| Inspect REST session | `node skills/blocks/scripts/blocks-session-cli.mjs get --profile <workspace-profile> --session <uuid>` |
| REST follow-up and wait | `node skills/blocks/scripts/blocks-session-cli.mjs follow-up --profile <workspace-profile> --session <uuid> --message "..." --wait` |

The helper reads only authenticated GitHub API data through `gh`. It returns
`requested`, `reviewing`, `clean`, `findings`, or `pr_closed`. A wait returns the
current state with `timedOut: true` rather than pretending completion.

## Procedure

1. **Start only at the review gate.** Confirm implementation is finished, the
   branch is pushed, the PR is open, and relevant local/CI checks are green.
2. **Resolve and baseline.** Read PR state, top-level comments, reviews, and
   inline comments. Save the request timestamp. **Complete when:** old Blocks
   messages cannot satisfy this request.
3. **Request exactly once.** Post `@blocks please review` or a precise question.
   Do not promise a duration. **Complete when:** the request comment URL exists.
4. **Classify honestly.** Help text, eyes reactions, queued messages, and “taking
   a look” mean `requested` or `reviewing`; they are not a review. A substantive
   review, inline finding, or clean end-to-end summary is terminal evidence.
5. **Await visibly.** Keep one tracked operation active and surface waiting
   progress. It follows the same
   pattern as Trigger.dev's `wait_for_run_to_complete`: observe updates, stop on
   terminal state, honour cancellation/timeout, and return current state on
   timeout. Unlike Trigger.dev, GitHub offers no Blocks event subscription here,
   so the helper polls at a conservative interval rather than busy-waiting.
6. **Triage every finding.** Collect top-level summaries, formal reviews, and
   inline comments. Preserve Blocks' severity; otherwise infer: security/data
   loss/broken contract = blocker, correctness/crash = high, refactor/quality =
   medium, style = low. **Complete when:** each finding has severity and file:line
   where available.
7. **Fix with the repository's workflow.** Address blocker/high findings; ask
   before medium/low judgment calls. Run affected tests and fresh verification.
8. **Explain intentional disagreements.** Reply with rationale instead of
   changing correct code. Record the item as deferred-with-rationale.
9. **Request re-review and repeat until green.** Push accepted fixes, ensure
   checks are green, re-baseline, request Blocks re-review, and await again. A
   review of an older head is not acceptance of the current head. Stop only on a
   clean current-head review, explicit user cancellation, closed PR, or a
   non-converging loop that must be escalated to the user. Never merge implicitly.

## Direct Blocks Sessions API

Use the REST path when the user wants a Blocks session rather than a GitHub
comment-driven review:

1. `POST /rest/v1/sessions` with one of `agent_name`, `agent_id`, or `profile`
   plus the first `message`.
2. Preserve the returned session ID, `session_html_url`, and opaque
   `_links.final_message.href`.
3. Poll that exact final-message link. Empty `items` means no final reply yet;
   the first assistant `final_message` is terminal for that turn.
4. Send follow-ups with `POST /rest/v1/sessions/{session_id}/messages`; each
   response has a new thread and final-message link. A follow-up can interrupt
   work already in flight, so send it only on explicit user intent.
5. On timeout, return the current empty page and `timedOut: true`; never claim
   the session failed or completed.

The implementation mirrors Trigger.dev's active-wait contract—bounded wait,
caller cancellation, latest state on timeout, errors propagated—but uses the
Blocks-documented polling transport instead of Trigger.dev's run subscription.

## Usage Examples

```text
Ask Blocks to review the PR for this branch, then await up to ten minutes. Tell
me whether it is queued, reviewing, clean, or has findings. Do not confuse an
eyes reaction or acknowledgement with completion.
```

```text
Get the current Blocks review status for PR 17. Include new reviews, inline
findings, and the Blocks dashboard session link if one was posted.
```

```text
Ask Blocks whether this migration has security or data-loss risks. Await the
answer, classify any findings, and do not change medium/low judgment calls
without asking me.
```

```text
Start a direct Blocks session with the Claude agent to review this architecture.
Wait up to ten minutes for the final message, preserve the session ID/dashboard
URL, and return the current state honestly if it times out.
```

## Pitfalls

- **Dashboard URL ≠ API link.** Use only REST URLs returned under `_links`.
- **Acknowledgement ≠ review.** Reactions and courtesy comments are nonterminal.
- **Old review ≠ current review.** Always compare against the baseline timestamp.
- **Infinite tool call.** Every wait needs timeout, cancellation, and a returned
  current state.
- **Tight polling.** Use at least a conservative multi-second interval; for
  background monitoring prefer scheduled checks measured in minutes.
- **Missing integration.** If Blocks never acknowledges or reviews after the
  agreed cap, report that the integration may be unavailable.
- **Follow-up interrupts.** Never send a REST follow-up merely to check status;
  poll the returned final-message link instead.

## Verification

- [ ] Request comment URL recorded.
- [ ] Baseline/request timestamp excludes older evidence.
- [ ] Status inspects comments, reviews, inline comments, and PR state.
- [ ] Courtesy and reactions remain nonterminal.
- [ ] Wait stops on clean/findings/closed, cancellation, or timeout.
- [ ] Timeout returns current state explicitly.
- [ ] Every finding is triaged; accepted fixes have fresh tests.
- [ ] Re-review requested after fixes; no merge is performed implicitly.
- [ ] REST keys stay in profile-scoped environment/Keychain storage; returned
      links are treated as opaque.
