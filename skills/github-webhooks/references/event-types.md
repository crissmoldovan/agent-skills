# GitHub webhook event reference

The events worth routing, their activity types, the payload fields that carry the
meaning, and when you would subscribe. Field paths are relative to the JSON body
unless stated otherwise.

Verify field names against the current GitHub documentation before shipping a
predicate that depends on one. GitHub adds activity types and payload fields over
time; a router that returns 200 for anything it does not recognise stays correct
when it does.

## Delivery envelope

Every delivery carries these headers:

| Header | Contents |
|---|---|
| `X-GitHub-Event` | The event name — `pull_request`, `push`, `ping`, … |
| `X-GitHub-Delivery` | A GUID for the delivery. Log it; do not use it as a uniqueness key. |
| `X-Hub-Signature-256` | `sha256=` followed by the hex HMAC-SHA256 of the raw body. This is the one to verify. |
| `X-Hub-Signature` | The legacy SHA-1 signature. Present for compatibility. Do not accept it as an alternative. |
| `X-GitHub-Hook-ID` | The id of the hook that produced the delivery. |
| `X-GitHub-Hook-Installation-Target-Type` | `repository`, `organization`, `integration`, … |
| `X-GitHub-Hook-Installation-Target-ID` | The id of that target. |
| `User-Agent` | `GitHub-Hookshot/` plus a build identifier. |

Almost every payload also carries `repository` (with `full_name`, `default_branch`,
`private`), `sender` (the user who caused it), `organization` for org-owned
repositories, and `installation` for GitHub App deliveries. The per-event sections
below list only what is specific to the event.

Two structural facts a router depends on:

- **Most events carry an `action` field**; some do not. `push`, `status`,
  `create`, `delete`, `fork`, `gollum`, `public`, and `ping` have none.
- **`ping`** is delivered once when the hook is created. Payload: `zen` (a random
  aphorism), `hook_id`, and `hook` — the hook's own configuration, including its
  subscribed `events` and its target URL. Answer it 200.

## Pull requests and review

### `pull_request`

**Actions:** `opened`, `edited`, `closed`, `reopened`, `assigned`, `unassigned`,
`review_requested`, `review_request_removed`, `labeled`, `unlabeled`,
`synchronize`, `converted_to_draft`, `ready_for_review`, `locked`, `unlocked`,
`milestoned`, `demilestoned`, `auto_merge_enabled`, `auto_merge_disabled`,
`enqueued`, `dequeued`.

**Fields that matter:**

- `number` — the pull request number. With `repository.full_name` this is the
  natural key for deduplication.
- `pull_request.merged` — boolean. **The only way to tell a merge from a plain
  close**; both arrive as `action: "closed"`.
- `pull_request.merged_at`, `pull_request.merge_commit_sha`,
  `pull_request.merged_by.login` — populated only on a merge.
- `pull_request.base.ref` / `pull_request.head.ref` / `pull_request.head.sha` —
  the branches and the commit the checks ran against.
- `pull_request.title`, `pull_request.body`, `pull_request.labels[].name`,
  `pull_request.draft`, `pull_request.html_url`, `pull_request.user.login`.
- `pull_request.additions`, `pull_request.deletions`,
  `pull_request.changed_files` — size of the change, without a second API call.
- `changes` — on `edited` only, e.g. `changes.title.from`, `changes.body.from`.

**Route it when:** you care about proposed or merged work. This is the event a
release ledger captures, filtered to `action === "closed" && pull_request.merged`.

### `pull_request_review`

**Actions:** `submitted`, `edited`, `dismissed`.

**Fields that matter:** `review.state` (`approved`, `changes_requested`,
`commented`, `dismissed`), `review.body`, `review.user.login`, `review.commit_id`,
`review.submitted_at`, `review.html_url`, and the whole `pull_request` object.

`review.state` arrives lower-cased in the webhook payload where the REST API
returns it upper-cased. Normalise before comparing.

**Route it when:** approvals gate something of yours — a deployment, a merge bot,
a review-latency metric.

### `pull_request_review_comment`

**Actions:** `created`, `edited`, `deleted`.

**Fields that matter:** `comment.body`, `comment.path`, `comment.line` and
`comment.start_line`, `comment.side`, `comment.diff_hunk`, `comment.commit_id`,
`comment.in_reply_to_id`, `comment.pull_request_review_id`, `comment.user.login`,
plus `pull_request`.

**Route it when:** you need line-anchored review discussion — a bot replying in a
thread, or mining where review effort concentrates. Note that comments on the pull
request as a whole are `issue_comment`, not this event.

## Commits and refs

### `push`

**No actions.**

**Fields that matter:**

- `ref` — the full ref, e.g. `refs/heads/main` or `refs/tags/v2.1.0`.
- `before` / `after` — the SHAs bracketing the push. `after` of all zeros means
  the ref was deleted.
- `created`, `deleted`, `forced` — booleans describing what happened to the ref.
- `base_ref` — the ref the branch was created from, when `created` is true.
- `commits[]` — each with `id`, `message`, `timestamp`, `url`, `author`, and the
  `added` / `removed` / `modified` path arrays. **Truncated for large pushes**;
  read the range from the API if you need all of them.
- `head_commit` — the last commit of the push, or null when the ref was deleted.
- `pusher.name`, `compare`.

**Route it when:** you react to commits rather than to pull requests — tag
releases, direct pushes to a protected branch, path-triggered rebuilds.

### `create`

**No actions.** Fields: `ref`, `ref_type` (`branch` or `tag`), `master_branch`,
`description`, `pusher_type`.

**Route it when:** you want tag creation without parsing `push` refs, or you track
branch creation. It does not fire for a repository's initial branch creation.

### `delete`

**No actions.** Fields: `ref`, `ref_type`, `pusher_type`.

**Route it when:** you keep per-branch state — preview environments, ephemeral
databases — and need to tear it down.

## Issues

### `issues`

**Actions:** `opened`, `edited`, `deleted`, `transferred`, `pinned`, `unpinned`,
`closed`, `reopened`, `assigned`, `unassigned`, `labeled`, `unlabeled`, `locked`,
`unlocked`, `milestoned`, `demilestoned`.

**Fields that matter:** `issue.number`, `issue.title`, `issue.body`,
`issue.state`, `issue.state_reason` (`completed`, `not_planned`, `reopened`),
`issue.labels[].name`, `issue.assignees[].login`, `issue.user.login`,
`issue.html_url`; plus `label` on the label actions, `assignee` on the assignment
actions, and `changes` on `edited`.

**Route it when:** you mirror issues into another tracker, or you drive workflow
from labels.

### `issue_comment`

**Actions:** `created`, `edited`, `deleted`.

**Fields that matter:** `comment.body`, `comment.id`, `comment.user.login`,
`comment.html_url`, `comment.created_at`; `issue.number`; and critically
**`issue.pull_request`** — present only when the commented-on issue is a pull
request. That key is how you tell the two apart, because GitHub delivers pull
request conversation comments as `issue_comment`.

**Route it when:** you implement comment commands (`/deploy`, `/rerun`) or thread
mirroring. Guard on `issue.pull_request` first.

## Checks and status

### `check_run`

**Actions:** `created`, `completed`, `rerequested`, `requested_action`.

**Fields that matter:** `check_run.name`, `check_run.head_sha`,
`check_run.status` (`queued`, `in_progress`, `completed`), `check_run.conclusion`
(`success`, `failure`, `neutral`, `cancelled`, `timed_out`, `action_required`,
`stale`, `skipped`), `check_run.started_at` / `completed_at`,
`check_run.output.title` and `output.summary`, `check_run.details_url`,
`check_run.pull_requests[]`, `check_run.app.slug` (which integration produced it),
and `requested_action.identifier` on `requested_action`.

**Route it when:** you react to an individual check — posting a failure summary,
rerunning a flaky job, gating on one named check rather than the whole suite.

### `check_suite`

**Actions:** `completed`, `requested`, `rerequested`.

**Fields that matter:** `check_suite.head_branch`, `check_suite.head_sha`,
`check_suite.status`, `check_suite.conclusion`, `check_suite.before` /
`check_suite.after`, `check_suite.pull_requests[]`,
`check_suite.latest_check_runs_count`, `check_suite.app.slug`.

**Route it when:** you want one signal per commit rather than one per check. A
GitHub App uses `requested` and `rerequested` as its cue to create check runs.

### `status`

**No actions.** This is the older Commit Status API, which many external CI
systems still write to.

**Fields that matter:** `sha`, `context` (the status name, e.g.
`ci/build`), `state` (`pending`, `success`, `failure`, `error`), `description`,
`target_url`, `branches[]` (the branches whose head is this commit), `commit`.

**Route it when:** an integration you depend on reports through statuses rather
than checks. Do not route both `status` and `check_run` for the same signal
without deduplicating — some tools emit both.

## Actions and deployment

### `workflow_run`

**Actions:** `requested`, `in_progress`, `completed`.

**Fields that matter:** `workflow_run.name`, `workflow_run.head_branch`,
`workflow_run.head_sha`, `workflow_run.event` (what triggered the workflow),
`workflow_run.status`, `workflow_run.conclusion`, `workflow_run.run_number`,
`workflow_run.run_attempt`, `workflow_run.workflow_id`, `workflow_run.html_url`,
`workflow_run.pull_requests[]`, and the `workflow` object with the workflow's
`path`.

**Route it when:** you need whole-workflow outcomes outside Actions — a release
gate, a notification on a failing scheduled workflow, or the fact that a deploy
workflow finished.

### `workflow_job`

**Actions:** `queued`, `in_progress`, `completed`, `waiting`.

**Fields that matter:** `workflow_job.run_id` (joins back to `workflow_run`),
`workflow_job.workflow_name`, `workflow_job.name`, `workflow_job.head_sha`,
`workflow_job.status`, `workflow_job.conclusion`, `workflow_job.labels[]` (the
`runs-on` labels), `workflow_job.runner_name`, `workflow_job.steps[]`,
`workflow_job.started_at` / `completed_at`.

**Route it when:** you autoscale self-hosted runners — `queued` with the requested
labels is the scale-up trigger — or you measure per-job queue time.

### `deployment`

**Actions:** `created`.

**Fields that matter:** `deployment.id`, `deployment.sha`, `deployment.ref`,
`deployment.environment`, `deployment.task`, `deployment.description`,
`deployment.payload` (the arbitrary object the creator attached),
`deployment.creator.login`, `deployment.production_environment` and
`deployment.transient_environment`.

**Route it when:** an external deployer listens for deployment requests. The
deployment record is a *request*; the outcome arrives as `deployment_status`.

### `deployment_status`

**Actions:** `created`.

**Fields that matter:** `deployment_status.state` (`queued`, `pending`,
`in_progress`, `success`, `failure`, `error`, `inactive`),
`deployment_status.environment`, `deployment_status.environment_url`,
`deployment_status.log_url`, `deployment_status.description`,
`deployment_status.creator.login`, plus the originating `deployment` object.

**Route it when:** you announce deployments or gate on one having succeeded.
`state === "success"` on the environment you care about is the usual predicate.

## Distribution

### `release`

**Actions:** `published`, `unpublished`, `created`, `edited`, `deleted`,
`prereleased`, `released`.

**Fields that matter:** `release.tag_name`, `release.name`, `release.body` (the
release notes, markdown), `release.draft`, `release.prerelease`,
`release.target_commitish`, `release.published_at`, `release.html_url`,
`release.assets[]` (each with `name`, `size`, `download_count`,
`browser_download_url`), `release.author.login`, and `changes` on `edited`.

**Route it when:** you announce releases or trigger downstream publication.
`published` fires for both a release and a prerelease; `released` fires only for a
non-prerelease, so pick according to whether prereleases should be announced.

### `package`

**Actions:** `published`, `updated`.

**Fields that matter:** `package.name`, `package.namespace`,
`package.package_type` (`npm`, `container`, `maven`, …), `package.owner.login`,
and `package.package_version` with its `version`, `target_commitish`, and
`html_url`.

**Route it when:** publishing an artifact should trigger something downstream —
a deployment, an internal registry mirror, a version bump elsewhere.

## Discussion and community

### `discussion`

**Actions include:** `created`, `edited`, `deleted`, `pinned`, `unpinned`,
`locked`, `unlocked`, `transferred`, `category_changed`, `labeled`, `unlabeled`,
`answered`, `unanswered`.

**Fields that matter:** `discussion.number`, `discussion.title`,
`discussion.body`, `discussion.category.name` and `category.slug`,
`discussion.state`, `discussion.answer_html_url`, `discussion.user.login`, and
`answer` on the `answered` action.

**Route it when:** you mirror community Q&A, or route new discussions in a
particular category to a team.

### `fork`

**No actions.** Fields: `forkee` — the complete repository object of the new fork,
including `full_name`, `owner.login`, and `private`.

**Route it when:** you track downstream copies of a repository. Nothing else fires
on a fork.

### `star`

**Actions:** `created`, `deleted`.

**Fields that matter:** `starred_at` — the timestamp on `created`, null on
`deleted` — and `sender.login`, the user who starred.

**Route it when:** you track repository popularity. The older `watch` event
(single action `started`) fires for the same user action and is still delivered;
subscribe to one of the two, not both.

## Administration

### `member`

**Actions:** `added`, `edited`, `removed`.

**Fields that matter:** `member.login`, `member.id`, `repository.full_name`, and
`changes` — carrying the permission that was assigned or changed, present on
`edited` and on `added` when a role was specified.

**Route it when:** repository collaborator changes must be mirrored into your own
access model, or audited.

### `repository`

**Actions:** `created`, `deleted`, `archived`, `unarchived`, `edited`, `renamed`,
`transferred`, `publicized`, `privatized`.

**Fields that matter:** the full `repository` object — `full_name`,
`default_branch`, `private`, `archived`, `topics[]` — and `changes`, which on
`renamed` carries the previous name and on `edited` carries the previous default
branch, description, homepage, or topics.

**Route it when:** you keep a repository inventory. `renamed` and `transferred`
are the two that break anything keyed on `full_name`, which is why keying on
`repository.id` is safer.

## Choosing a subscription set

Subscribe to the smallest set that answers your questions:

| You want | Subscribe to |
|---|---|
| Merged work, for a changelog or ledger | `pull_request` |
| Commits, including direct pushes and tags | `push` |
| Release announcements | `release` |
| CI outcome per commit | `check_suite`, or `status` for older integrations |
| CI outcome per named job | `check_run` |
| Deployment outcomes | `deployment_status` |
| Comment-driven commands | `issue_comment` |
| Repository inventory | `repository`, `create`, `delete` |

Everything else is volume you will discard. Add an event when a handler for it
exists, not before.
