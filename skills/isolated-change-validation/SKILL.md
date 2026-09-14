---
name: isolated-change-validation
description: "Validate a change in a sandbox physically separate from the trusted tree, and earn a verdict a reader can check rather than a builder's claim: freeze the source identity in a hash manifest before the first edit, declare the path budget, watch one RED per behaviour, run the gates yourself, review on independent axes, classify every scan hit, and hand the run over as runnable state. Symptoms: prove this works before it goes anywhere near main, the agent says the tests pass, validate this in a sandbox, the scratch tree has no git, an overnight unattended run someone else picks up, keep the accepted candidate somewhere it cannot be lost, the sandbox must not be able to reach the real repository. For a change you are landing in the repository itself, use a delivery skill; this is for work that stays outside it until it is accepted."
license: MIT
compatibility: "Any codebase that can be copied into a scratch directory and checked with deterministic commands. Git is optional: file-hash manifests replace revision identity in copied or no-git sandboxes. Uses the project's own package manager, typechecker and test runner; installs no framework. Subagents are optional; without them the implementer and reviewer roles are passes run in sequence. Output is a verdict, the evidence behind each of its claims, and a handoff bundle another agent can re-run."
metadata: "group=workflow; lifecycle=delivery; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Edit Grep Glob Bash
---

# Validate an isolated change

A change that must not reach the trusted tree until it is accepted needs two things an
ordinary review does not provide: a lane that is *physically* separate, and a verdict built
from evidence the parent gathered itself.

Both fail quietly. A sandbox sharing a dependency tree, a build output or a state directory
with the trusted candidate is one command away from proving the wrong bytes — and it proves
them in green. A builder's report that the suite passes is a claim about a tree the reader
never saw: it survives a run that was stopped and restarted, an implementation written before
its test, and a file created outside the declared budget, because each of those still produces
a passing line. Nothing in the report distinguishes them, and nothing in the diff does either.

This skill owns the isolation and the evidence ladder that turns a claim into a verdict: the
physical lane, the frozen source identity, the path budget, the gate order the parent runs
itself, the independent review axes, the classification of every scan hit, and the bundle the
run is handed over in. It does not own the change, and it does not own landing it.

**Technical acceptance is not landing authority.** A verdict of accepted-in-sandbox says the
bytes in the lane pass the gates named in the artifact. Transfer into the real repository, a
commit or push, a publication, a visibility change, signing, an account or billing change and
a live-provider call are separate acts, each requiring its own authorization, and none of them
is implied by a green run.

### What this skill does not own

| The job | Whose it is | What this skill does with it |
|---|---|---|
| Landing a change in the repository, with its touch-set budget and regression gate ladder | `land-complex-change` | Runs *before* it, in a tree that is not the repository. The budget here bounds a scratch lane and a sandbox verdict; that skill's budget bounds a diff that is actually landing. Hands over the accepted candidate and its pins. |
| What a proposed change would affect | `blast-area` | Consumes its map as the budget's source where one exists; re-enters it when the budget is breached. Maps nothing itself. |
| Which repository the work belongs in, and the tree it happens in | `work-in-external-repo` | Takes the located repository and base ref as given; the scratch lane is a copy, not a worktree. |
| Dispatching children and seeing what they did | `agent-lifecycle` | Consumes it. Reconciliation at the end of a run is its evidence, not a guess from exit metadata. |
| What the reader is told while the run is going | `report-progress` | Supplies the rows; owns none of the shape. |
| The review loop on a pull request | `request-blocks-review` | Different gate. The reviews here run inside the sandbox on a candidate that has no pull request yet. |
| Answering a question about the code | `investigate-codebase` | Delegates every search that is not a hash, a gate or a budget check. |
| Placing a credential, or any live authenticated call | `secure-credential-setup` | Places none. A skipped live gate is recorded as skipped, never as passed. |
| The note and the release that follow acceptance | `release-notes`, `publish-agent-skill` | Neither is reached by this skill. Acceptance is an input to them. |

## When to Use

- Implementation must stay physically separate from a trusted candidate or main checkout while
  still earning a reviewable verdict.
- A delegated agent will write the code and report on itself, and that report is the only thing
  standing between the work and acceptance.
- The scratch tree has no git, so revision identity has to come from file hashes.
- The run is long or unattended, and whoever picks it up next will not have watched it.
- Several candidate lanes exist at once — accepted, working-but-unaccepted, dirty local — and
  they must not be allowed to blur into one another.
- An accepted candidate exists only in a scratch directory that a reboot would take with it.

Do not use it for a change you are landing in the repository now: that is `land-complex-change`
in a worktree. Do not use it as a general test-running procedure — everything here is overhead
paid for the physical separation. Do not use it to decide *what* a change should touch; that
question belongs to `blast-area` and arrives here as an input.

## Prerequisites

1. **A scratch location outside the trusted tree**, on the same filesystem semantics as the
   project, with room for a full source copy.
   **Complete when:** the path exists, is not inside the trusted checkout, and is not a
   directory another run is using.
2. **The project's own deterministic commands** — typecheck, build, focused tests, full suite,
   downstream consumers — each runnable without network access where that is claimed.
   **Complete when:** each command is written down as exact argv, and the ones that need
   network or credentials are marked as such before anything runs.
3. **The budget's source.** A blast map, or the user's explicit statement of what may change.
   **Complete when:** the allowed existing paths and allowed new paths are two separate lists,
   both written before dispatch.
4. **Durable storage for the handoff bundle** — a private remote, or a location no cleanup of
   the scratch tree can reach.
   **Complete when:** the destination is named and is not inside the lane it preserves.
5. **The authority boundaries, written down.** Which acts this run may perform and which it may
   only prepare.
   **Complete when:** transfer, commit, push, publication, visibility, signing, account,
   billing and live-provider calls each carry a yes or a no, agreed before the run.

## Procedure

1. **Create a physical lane and freeze the source identity.** Copy product source into a new
   scratch directory, excluding dependency trees and generated output. Reattach dependencies
   read-only only after the copy. Write a baseline SHA-256 manifest of every source and config
   file the change could affect, and record the deliberate omissions — compiler caches, lock
   files you will regenerate — beside it, so a later reader can tell an omission from a miss.
   Verify the trusted lane against its own manifest immediately: a baseline written after the
   first edit is a description of the edit.
   **Complete when:** the two lanes share no product source, state or generated output, and
   both verify against manifests written before any change.

2. **Declare the budget before dispatch.** Record the allowed existing paths, the allowed new
   paths, the generated artifacts that are permitted, the acts that are forbidden regardless,
   and the rule for what happens on breach — which is to stop, not to absorb. Changed files and
   new files are separate sets, and acceptance later requires **exact equality** with both, not
   a subset: a file that was permitted and never touched is a signal too.
   **Complete when:** both sets exist in the artifact, and the breach rule is written where the
   implementer reads it.

3. **Pin the implementer's contract.** One implementation owner gets the lane path, the exact
   path budget, the test commands, the vertical TDD sequence, the report schema, and the
   explicit prohibitions: no other sandbox, no trusted tree, no publication, no process-wide
   signals, no account changes. Require an early checkpoint and the final report before the
   last few turns, so a turn limit costs the report rather than the run.
   **Complete when:** the contract names the lane, both path sets, the commands and the schema,
   and the owner has acknowledged the breach rule.

4. **Enforce vertical TDD at the filesystem boundary.** For each behaviour:
   **one assertion-level RED → minimal GREEN → the whole affected test file GREEN**, before the
   next test exists. Watch the product hashes, not the prose: the evidence that a test was
   written first is that the implementation file's hash was unchanged when the test failed. If
   an owner batches several REDs, or writes implementation before its RED, stop that exact
   child, discard the entire invalid delta back to independently pinned bytes, and restart.
   Do not keep the discarded implementation as a reference — a mechanism that lets tests-after
   become tests-first by retyping is not a mechanism.
   **Complete when:** every behaviour has an observed RED at a hash where its implementation did
   not yet exist, and each GREEN covers the whole affected file.

5. **Use exact rollback, not reconstruction.** In a lane with no git, restore a stopped agent's
   work only from a mirror whose hashes match the pre-attempt manifest, and verify every
   restored hash before resuming. A cleanup helper that exits without writing is a failed
   cleanup even when it prints a correct plan. The parent may perform byte-for-byte cleanup of a
   dead agent's lane: rollback is orchestration, not implementation.
   **Complete when:** the restored lane matches the pre-attempt manifest hash for hash, and the
   restore is recorded as a process event rather than as product history.

6. **Run the parent's gates yourself, in dependency order.** Typecheck and build the changed
   package, then its focused tests, then its full suite, then downstream consumers. Never accept
   a report in place of a run. In a copied workspace, do not approve an implicit reinstall that
   would purge the dependency tree you attached: preserve that result, and for source
   verification call the already-installed binaries directly:

   ```sh
   env -u NODE_PATH node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
   env -u NODE_PATH node node_modules/vitest/vitest.mjs run
   ```

   Label that as source verification. It proves the current source against an existing
   dependency tree, and it is not a clean install or an external-consumer gate.
   **Complete when:** every gate's exit status, totals and invocation are recorded by the
   parent, and each is labelled with what it does and does not prove.

7. **Isolate build outputs from the budget.** A production build that writes caches or bundles
   into the product lane has widened it. Copy source into a verification scratch tree, link only
   the candidate's dependency tree read-only, build there, and compare the consumed package or
   compiled output by hash. A green build that grew the lane is a side effect, not a clean gate.
   **Complete when:** the product lane's post-build hashes still match the declared budget, or
   the extra paths were declared before the build ran.

8. **Review on independent axes.** Split contract and data validation from runtime, composition
   and import boundaries. Give each reviewer the candidate patch, the source pins, the budget,
   the static-scan findings and a strict report schema; require them to write only inside their
   own scratch directory and to fail closed on any source-hash mismatch. A reviewer whose tests
   execute compiled output needs a scratch rebuild or a hash-verified build directory —
   otherwise a source-only mirror produces a harness failure wearing a product verdict's clothes.
   **Complete when:** each axis reports against source hashes that match the post-review pinning
   in step 10, and no reviewer wrote inside the product lane.

9. **Recover evidence without rewriting history.** When a reviewer finishes its probes but runs
   out of turns before its report, keep the terminal failure and resume that same
   evidence-bearing session for synthesis only — no new probes in the synthesis turn. If the
   session cannot be resumed, start a fresh reviewer on the same narrow axis and record the
   unavailable resume as a process failure. A recovered report never converts the original run
   into a successful one.
   **Complete when:** the artifact holds both the process failure and the recovered evidence, as
   two separate facts.

10. **Aggregate only after post-review pinning.** Re-hash every allowed path, verify the trusted
    lane still matches its baseline, assert exact changed and new sets, parse test totals
    programmatically rather than reading them, compare exports for additions and removals, and
    **classify every static-scan hit**: a scan with unclassified hits is an unfinished scan, not
    a clean one. Read each artifact before accessing its keys; after any schema correction, rerun
    the complete assertion set from the beginning rather than patching the run in place.
    See [the evidence contract](references/evidence-contract.md) for the shapes.
    **Complete when:** every assertion ran against post-review hashes in one uninterrupted pass,
    and the scan reports zero unclassified hits.

11. **Make the verdict explicit.** *Technically accepted in isolated sandbox* requires exact
    source pins, the parent's own gates, independent review, and no unresolved blocking finding.
    Keep separate fields for process failures, residual risks, skipped live or authenticated
    gates, clean-consumer status, and isolation and landing authorization. A fixture tracer
    proves the adapter path, not provider authentication or live model behaviour; say which one
    you ran.
    **Complete when:** a reader can tell, from the artifact alone, what was exercised, what was
    skipped, and what the verdict does not authorize.

12. **Hand the run over as state, not prose.** A handoff document is not a handoff. Preserve, in
    durable storage outside the lane, every lane as its own labelled thing — accepted candidate,
    working-but-unaccepted work, dirty or external checkouts — plus the runnable artifacts, the
    evidence, the authority boundaries, a manifest over all of it, and a verifier the next agent
    runs before trusting any of it. Dirty product work and external-repository deltas are lanes
    too: a backup that silently drops them reads as complete and is not.
    See [the handoff bundle](references/handoff-bundle.md).
    **Complete when:** the bundle's verifier passes from a fresh clone of it, and every lane in
    it is labelled with its acceptance state.

13. **Close the run.** Reconcile each child against both terminal-result evidence and OS
    liveness — null exit metadata alone is not terminal proof. Reap only the sessions this run
    owns, update the task record, and write the run record outside the repository under test.
    Name the final artifact, and name what the run could not see.
    **Complete when:** no child is left unreconciled, and the closing report names the final
    artifact path and the run's blind spots.

## Usage Examples

```text
Validate this change in a sandbox. Copy the source into a scratch lane, hash-pin it before you
touch anything, and tell me the allowed existing paths and allowed new paths before you dispatch
a builder. If anything lands outside that set, stop and show me — do not fold it in.
```

```text
The builder reports 1042 passing. Do not take that. Re-hash its lane, run the typecheck, build,
focused tests and full suite yourself, and show me the totals you parsed from the runner rather
than from its message. If the suite ran with a live provider key, that number is contaminated —
rerun it with the live tests excluded and say so.
```

```text
This runs overnight and I will not be watching. Before you finish, write the handoff bundle:
the accepted lane, the work that is not accepted, the dirty checkout, the artifacts, the
evidence and a manifest, in the private remote — not in the scratch directory. Then verify the
bundle from a fresh clone and tell me the verifier's output.
```

```text
Accepted in the sandbox is all I am asking for. Do not transfer it into the repository, do not
commit, push or publish, and do not call a live provider. If a gate needs any of those, record
it as skipped with the authority it would need.
```

## Pitfalls

- **A filtered lock regeneration is not importer isolation.** `pnpm --filter <package> install
  --lockfile-only` can still reconcile every workspace importer. In one run it pulled a
  pre-existing, unrelated importer graph into the lock; the change would have been attributed to
  the package under test. Diff the whole lock file, and when it moves something you did not
  touch, stop and re-enter the budget rather than explaining it away.
- **A scratch `HOME` changes package-manager resolution.** A Corepack shim may bootstrap or
  download a package manager again when `HOME` is redirected, which is a network act inside a
  lane you called offline. Invoke a pinned entrypoint or set an isolated Corepack home, use
  supported store and XDG paths, and read the installed CLI's own help before adding options —
  one pnpm version rejects `--state-dir`, and the failed attempt belongs in the evidence.
- **A frozen-install log without its invocation is incomplete evidence.** Persist, before
  execution, the exact argv, the non-secret environment paths, the empty dependency-tree and
  store preconditions, and the input hashes; afterwards, the exit status and the unchanged lock
  hash. Without them an independent reader cannot separate a real clean install from a reused
  tree or an implicit bypass.
- **Inferring an artifact's schema.** A boolean, a count and a list can encode the same fact
  under incompatible types. Read and normalize before asserting; one verifier that guessed
  reported a clean result against a schema that did not exist.
- **Accepting a report path.** A terminal result, a parseable report, matching source hashes and
  a parent replay are four separate facts, and any one of them can survive a failed run alone.
- **Calling copied-tree checks a clean install.** Direct binaries prove current source against an
  existing dependency tree. Saying more than that is how an unproven consumer story ships.
- **Reusing generated output in review.** Stale build output makes source review and runtime
  evidence disagree, and the disagreement usually surfaces after acceptance.
- **Cleaning with broad process signals.** A pattern kill can stop the service under test, and
  then the lifecycle evidence is about your cleanup rather than the product.
- **A secret scan with unclassified hits.** Raw hits are not findings. Classify each one —
  credential-shaped test fixture, documentation example, real credential — and require zero
  unclassified before any bundle leaves the machine. A scan that "found 74 hits" and stopped
  there tells the next reader nothing and blocks nothing.
- **Hiding non-blocking residuals behind a pass.** Keep them in the final artifact with the gate
  that would settle each one. Technical acceptance is scoped, not absolute.
- **A handoff that is only prose.** The next agent cannot re-run a paragraph. If the bundle has
  no manifest and no verifier, its first act is to re-derive everything you already proved.

## Verification

- [ ] Trusted and implementation lanes are physically separate, sharing no source, state or
      generated output.
- [ ] The baseline manifest and both path sets predate the first edit.
- [ ] Every behaviour has its own observed RED before implementation, and a GREEN over the whole
      affected file before the next behaviour.
- [ ] Invalid partial work was restored to independently pinned bytes, hash for hash.
- [ ] The parent ran typecheck, build, focused, full and downstream gates itself, in that order.
- [ ] Generated output stayed outside the product budget, or was declared before the build.
- [ ] Each review axis matches the post-review source hashes, and no reviewer wrote in the
      product lane.
- [ ] The static scan has zero unclassified hits.
- [ ] Process failures and product findings are separate fields in the artifact.
- [ ] Clean-install, live-provider, transfer and publication claims appear only where the act was
      directly exercised and authorized.
- [ ] The final aggregation was rerun in full after any schema correction.
- [ ] The handoff bundle exists outside the lane, labels every lane's acceptance state, and its
      verifier passes from a fresh copy.
- [ ] The final artifact names the residuals, the isolation state, and the gates that would
      settle each.

The run is finished when a reader who saw none of it can say which bytes were validated, which
gates ran, which did not, and what the verdict does not authorize.
