# GitHub webhook payload cookbook

Worked predicates. Each recipe states the event, the condition, and the exact
fields the condition reads, so a reviewer can check it against
[the event reference](event-types.md) without running anything.

Field names follow the JSON payload. Examples are JavaScript for concreteness;
the logic ports unchanged.

## 0. The gate every recipe sits behind

Verification runs before any predicate, over the raw bytes.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function isSignedByGitHub(rawBody, signatureHeader) {
  const key = process.env.GITHUB_WEBHOOK_SIGNING_VALUE;
  if (!key || !signatureHeader) return false;

  const expected = Buffer.from(
    `sha256=${createHmac('sha256', key).update(rawBody).digest('hex')}`,
    'utf8',
  );
  const received = Buffer.from(signatureHeader, 'utf8');

  // timingSafeEqual throws on a length mismatch, so check length first.
  return expected.length === received.length && timingSafeEqual(expected, received);
}
```

`rawBody` is a `Buffer` or the exact string the request carried. Re-serializing a
parsed object produces different bytes and the comparison will never succeed.

## 1. A pull request merged into the default branch

The capture predicate for a release ledger. It must not fire for a pull request
that was closed without merging, nor for merges into a release or feature branch.

```js
function isMergeToDefaultBranch(payload) {
  return payload.action === 'closed'
    && payload.pull_request.merged === true
    && payload.pull_request.base.ref === payload.repository.default_branch;
}
```

**Reads:** `action`, `pull_request.merged`, `pull_request.base.ref`,
`repository.default_branch`.

**Natural key for deduplication:** `repository.full_name` plus `number`.

**Why not `merged_at`:** it is populated on a merge, so testing it works, but
`merged` states the intent directly and does not require a null check.

## 2. A tag push

Tag creation arrives two ways. Prefer `create`; use the `push` form only when you
also need the commit the tag points at.

```js
// event: create
function isTagCreated(payload) {
  return payload.ref_type === 'tag';
}

// event: push  — same fact, with the target SHA
function isTagPush(payload) {
  return payload.ref.startsWith('refs/tags/')
    && payload.created === true;
}
```

**Reads:** `ref_type` and `ref` on `create`; `ref` and `created` on `push`.

**Trap:** on a `push` that deletes a ref, `after` is forty zeros and `head_commit`
is null. Test `deleted` before dereferencing `head_commit` anywhere.

```js
const isRefDeletion = payload.deleted === true
  || payload.after === '0'.repeat(40);
```

## 3. A check regression on the default branch

"Something that used to pass now fails." Route only completed runs with a bad
conclusion, and only for the branch that matters.

```js
const FAILING = new Set(['failure', 'timed_out', 'action_required']);

function isCheckRegression(payload) {
  const run = payload.check_run;
  return payload.action === 'completed'
    && run.status === 'completed'
    && FAILING.has(run.conclusion)
    && run.check_suite.head_branch === payload.repository.default_branch;
}
```

**Reads:** `action`, `check_run.status`, `check_run.conclusion`,
`check_run.check_suite.head_branch`, `repository.default_branch`.

**Deliberately excluded conclusions:** `cancelled` (someone stopped it),
`neutral`, `skipped`, and `stale` (superseded by a newer run). Alerting on those
trains people to ignore the alert.

**Natural key:** `check_run.head_sha` plus `check_run.name`. A rerun of the same
check on the same commit is the same fact.

## 4. The same signal from the older Commit Status API

Some integrations never moved to checks. This is the equivalent predicate.

```js
function isStatusFailure(payload) {
  return (payload.state === 'failure' || payload.state === 'error')
    && payload.branches.some((b) => b.name === payload.repository.default_branch);
}
```

**Reads:** `state`, `branches[].name`, `repository.default_branch`.

`status` has no `action` field. `branches` lists the branches whose head is this
commit, which is how you scope a commit-keyed event to a branch.

## 5. An approving review

```js
function isApproval(payload) {
  return payload.action === 'submitted'
    && payload.review.state.toLowerCase() === 'approved';
}
```

**Reads:** `action`, `review.state`.

**Trap:** the webhook delivers `review.state` lower-cased where the REST API
returns it upper-cased. Lower-case both sides rather than remembering which
source a value came from.

## 6. A comment command, on a pull request only

```js
function parseCommand(payload) {
  if (payload.action !== 'created') return null;
  if (!payload.issue.pull_request) return null;      // an issue, not a PR

  const match = /^\/(\w+)(?:\s+(.*))?$/m.exec(payload.comment.body.trim());
  return match ? { name: match[1], args: match[2] ?? '' } : null;
}
```

**Reads:** `action`, `issue.pull_request` (presence only), `comment.body`.

**Trap:** `issue_comment` covers both issues and pull requests. The `pull_request`
key on `issue` is present only for the latter, and that presence check is the only
reliable discriminator. Also ignore comments whose `sender.type` is `Bot` unless
you want a command loop.

## 7. A successful deployment to a named environment

```js
function isProductionDeploySucceeded(payload) {
  return payload.deployment_status.state === 'success'
    && payload.deployment.environment === 'production';
}
```

**Reads:** `deployment_status.state`, `deployment.environment`.

**Trap:** read the environment from `deployment`, not from `deployment_status`.
Both carry the field, and the deployment record is the authoritative one.

## 8. A workflow run that finished, for a specific workflow

```js
function isReleaseWorkflowCompleted(payload) {
  return payload.action === 'completed'
    && payload.workflow_run.conclusion === 'success'
    && payload.workflow.path === '.github/workflows/release.yml';
}
```

**Reads:** `action`, `workflow_run.conclusion`, `workflow.path`.

**Trap:** match on `workflow.path`, not on `workflow_run.name`. The display name
is editable in the workflow file and changing it silently unsubscribes you.

## 9. A published release that is not a prerelease

```js
function isStableRelease(payload) {
  return payload.action === 'published'
    && payload.release.draft === false
    && payload.release.prerelease === false;
}
```

**Reads:** `action`, `release.draft`, `release.prerelease`.

**Alternative:** subscribe to the `released` action instead, which fires only for
non-prereleases. Use one approach or the other; using both double-fires.

## 10. A push that touched a path

For path-scoped rebuilds without a full checkout.

```js
function touchesPath(payload, prefix) {
  return payload.commits.some((c) =>
    [...c.added, ...c.removed, ...c.modified].some((p) => p.startsWith(prefix)));
}
```

**Reads:** `commits[].added`, `commits[].removed`, `commits[].modified`.

**Trap:** the `commits` array is truncated on large pushes, so a negative answer
is not proof. When the push is large — or when `commits.length` equals whatever
cap you observe — fall back to comparing `before..after` through the API.

## Recording the routing decision

Whatever the predicates, log one line per delivery with the event name, the
action, the delivery id, the predicate that matched (or `unrouted`), and the
response code. That log is what turns "we think we missed a merge" into a
five-minute answer, and it is the only place the delivery id belongs.
