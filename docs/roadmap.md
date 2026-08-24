# Roadmap

This document records future development that is intentionally outside the
current public release. It is not a promise that unfinished capabilities are
already available.

## Private control plane → public delivery

The private CUE++ skills platform remains the team control plane for drafts,
validation, review, audit history, feedback, statuses, stacks, and private
delivery. A future publication bridge should allow an approved skill to target
either the private catalog or this public repository without moving those team
workflows into public infrastructure.

Planned work:

1. Add an explicit `private | public` delivery target to the control-plane
   submission model.
2. Keep private drafts, revisions, audit entries, signals, and team review in
   the private platform for both targets.
3. Open public-target pull requests against `cueplusplus/agent-skills` while
   private-target submissions continue to use the private catalog repository.
4. Make publication-status checks target-aware: private catalog deployment for
   private skills, and public GitHub/Skills.sh availability for public skills.
5. Record the final public repository, commit, release, and skill coordinates
   in the private audit trail.
6. Preserve a human merge gate and never let the publishing service merge its
   own pull requests.

This work must be staged around the private control plane's active identity,
database-migration, and deployment work. The public repository must not depend
on private services to install or run its released skills.

## Lifecycle host integrations

The portable lifecycle core and Hermes reconciliation adapter foundation are
released separately. Future host work may wire those contracts into additional
harness surfaces, provided each integration:

- prefers native child-agent UI when the harness owns the child;
- treats lifecycle projection, not todos, as authority;
- reconciles after reconnect or missed events;
- reports activity, heartbeat, stale, lost, and terminal evidence distinctly;
- does not claim arbitrary foreign-process adoption unless the host actually
  supports it.

## Additional harnesses

Claude Code, Codex, Cursor, Kimi Code, and other harnesses remain candidates for
fully exercised routing/profile adapters. Documentation-only compatibility is
not a shipped integration. Each adapter must have live inventory discovery,
transactional apply/read-back/reset behavior, scope isolation, and acceptance
tests before it is listed as supported.

## Distribution conveniences

- Publish an optional Skills.sh pack containing the two existing skills. The
  pack is an install convenience, not a third skill or source of truth.
- Keep the Hermes `routed-delegation` bundle as a load-time convenience; it
  installs nothing.
- Do not place private content in a Skills.sh pack: pack URLs are unlisted, not
  access-controlled.

The two individual Skills.sh pages are already live; the optional item above is
only the combined pack convenience, not basic skill publication.

## Non-goals

- A third coordinator skill that duplicates `model-routing` and
  `agent-lifecycle`.
- Silent dependency installation or model substitution.
- Moving private team-management data into this public repository.
- Treating a task board, percentage, or todo edit as lifecycle evidence.