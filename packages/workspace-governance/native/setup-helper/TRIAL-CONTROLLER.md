# Native candidate-trial issuer and authenticated admission

## Current initial strict transaction boundary

The installed native callback supports a fresh absent-state, explicitly approved
manifest-init trial through the strict ledger. It creates canonical manifest-v1,
rootless state, exact BytePayload captures and canonical-LF evidence/event/result
records. It preserves an identical manifest for a zero-action trial. New-ID,
same-candidate/environment completed recognition is described below. No development
ledger is used; incomplete effects and orphan repair remain unsupported.

The fixed conservative pre-journal reservation order is stateDir, operations/,
operations/ID, captures/, payloads/, evidence/, events/. Their retained descriptor
identities are not retroactively described as pre-journal evidence. owner.json is
only diagnostic. A partial bootstrap is preserved, never inferred or repaired.
Capture names include trial-intent.json, trial-record.json, candidate-manifest.json,
trial-anchor.json and approved-plan.json. All file temporaries are same-parent
`.<basename>.pending`, except the manifest's fixed
`.workspacectl-init-<operationId>.pending`. No sibling bootstrap file is added.
Before any transaction lock creation, native preflight requires pairwise disjoint
manifest final, manifest temporary, state bookkeeping subtree and both lock
namespaces (including equality and ancestor intersections). The same check runs
under held locks. Fixed internal bookkeeping finals and their dot-prefixed
pending slots are distinct within each parent; state-subtree exclusion covers
all of them. This is not a basename-prefix ban: nearby names and equal basenames
in separate approved parents remain valid. Rejected consumed trials retain their
registry reservation but create no transaction lock or fixture state; no partial
state is repaired or removed.

Full native approval and serialized-size/headroom preflight precede lock creation;
full admission repeats under the sorted independent manifest/state locks. Later
phase-aware gates retain unchanged input/candidate/registry bindings and exact
owned progress, directory membership, named-parent/mount/inode/bytes/mode facts.
Only measured native allocations and expected mkdir link increments evolve facts.
Original absent-state approval is not rederived against its own new state.

A concurrent bounded reader observes cancellation/EOF; one reply owner controls
terminalization. Accepted preterminal cancellation returns TOOL_FAILURE; late
cancellation queues during the complete evidence/event durability section. Success
requires actual no-replace, file/parent fsync and readback barriers, not a boolean
callback. Locks and authority witnesses survive reply handling and reader
quiescence. Handshake is bounded to 30 seconds; initial apply is bounded to 300
seconds and additionally by the unchanged issued trial CLOCK_BOOTTIME lifetime.

This is a pending candidate, not deployment qualification or completed scaffold.
Independent source-pinned review and parent artifact verification are required.
Actual fault/terminal coverage is recorded outside this portable source in the
writer handoff; implementation alone does not close FT or storage qualification.
The following transport-only and startup-only descriptions are historical.

## Completed strict-trial recovery (B; not deployment qualification)

```text
workspacectl-init-trial-controller issue-recovery INSTALL_ROOT --prior-trial-id ID --operation-id ID --approve DIGEST
workspacectl-init-trial-controller launch INSTALL_ROOT NEW_TRIAL_ID --approve DIGEST
```

`issue-recovery` accepts exactly those three distinct flags, validates literal
identifiers before lookup, and generates the new random ID itself. It publishes
only the new immutable issuance bundle, under the retained registry guard.
Successful stdout is canonical CandidateTrial JSON plus one LF, byte-identical to
new `T.json`; unlike initial `T.json`, this recovery record itself includes that LF.
Issuance never starts Node/helper or consumes T. Do not call `reserve` before
`launch`: that would consume the attempt without running it.

Operation and fixture indices remain rooted at the original consumed apply trial.
Every selected historical predecessor must be issued and consumed, with valid
closed receipts, reservation, captures and input map. Traversal refuses cycles,
missing/unconsumed/unrelated links, more than 256 historical trials including the
root, or more than 16 MiB of relied-on historical registry bytes. Siblings selecting
the root again are intentionally allowed; prior does not mean latest or successful.
No prior outcome file is invented. No consumed or partial record is reset/deleted.

Each recovery copies the root's exact candidate/intent/plan bytes. Its input map
explicitly names the root registry's three corresponding captures, not original
external input files. Historical input maps and receipts are still validated.
Original plan semantics/resources, policy, payloads and create/noop actions are
rederived natively. Removed original request files do not block fully completed
recognition, but do not authorize missing effects. Current full environment,
exact candidate/runtime, trust anchor, live process ancestry, lifetime and registry
reservation checks remain mandatory in controller, installed addon and helper.

B accepts only the initial producer's completed create/noop phase schedules and
exact compatible directory membership, singleton identity, final facts and linkage.
It refuses candidate-only originals and byte-identical replacements alike when no
complete identity witness exists. Orphan complete evidence is also refused: C is
not implemented. Pending/foreign/unsafe/corrupt objects are never cleaned up.
Existing complete locks must be present, safe and empty; this bounded recognizer
does not reconstruct missing lock objects. Registry and operation preflight runs
before effects and repeats under the applicable locks with retained descriptors.
The stricter existing 262144-byte individual capture/read ceiling remains; larger
records conservatively fail rather than increasing protocol limits.

The sole installed mutation path is still controller → pinned Node/CLI → native
callback → pinned helper. Under both transaction locks the helper actively fsyncs
all required existing files and parent directories, evidence before referring
events, and complete's event-directory barrier last. It checks actual syscall
success and retained identities, then emits one native-validated original Result.
No manifest/state/operation bytes, inodes, or events are created or replaced by B,
including on failure after visible complete. Cancellation/EOF queues within the
bounded terminal section; locks survive the one begin response and quiescence.
`mutation-status` remains a separate observational read with no durability claim.

Use a fresh fixture initially created by this very same recovery-capable candidate.
Candidate upgrades, changed environments, arbitrary interrupted effects, bootstrap
repair, orphan repair, ordinary qualified consumers and full scaffold delivery are
not provided. Exact installed tests are in `tests/completed_recovery.py`; external
observer and acceptance evidence belong outside the package. Source review and
parent fresh exact-artifact verification remain separate required release gates.

The sections below retain **historical** transport/startup milestones, including
their then-missing capabilities. Their unsupported-recovery claims do not override
this current B boundary.

## Historical strict transport boundary

The installed native callback now exchanges strict numbered capabilities, begin
and cancel frames with the authenticated helper. Begin is derived from the exact
saved plan/context and current Node host facts. Runtime capabilities are checked
against the pinned declaration. Native full no-write approval precedes preparation
and acquisition of independently derived sorted manifest/state locks; every existing
lock is inspected before any lock is created. Full native admission is repeated
under those locks, retaining original registry witnesses through quiescence.

A bounded concurrent reader services cancel/EOF while the sole reply writer runs
admission. The normal begin returns the strict `UNSUPPORTED` error with `reason:null`,
then cancel is acknowledged. **No strict trial ledger, manifest, state directory,
apply/recover success or qualification is implemented.** Persistent lock files can
remain after valid initial admission. The historical startup-only details below
are superseded where they describe the old diagnostic response or absence of begin
and transaction-lock dispatch. Independent review is required for these new bytes.

This executable implements operator issuance, durable one-use reservation and a
bounded authenticated admission through the exact installed CLI and native
N-API/helper. It is **not an installed init writer, deployment qualification,
or permission to run an arbitrary command**. There is no transaction callback
or environment grant.

## Operator interface

Build with the separately approved pinned native toolchain, offline:

```sh
cargo build --locked --offline --release --bin workspacectl-init-trial-controller
cargo build --locked --offline --release --bin workspacectl-init-helper
cargo rustc --locked --offline --release --lib --crate-type cdylib
```

The operator independently provisions this executable at mode 0700, records its
exact SHA256 in the fixed helper-install sidecar, and provisions the private
registry and fixture parent. These are not installation hooks or candidate writes.
The controller checks that its actual `/proc/PID/exe`, uid, start/parent/boot facts
and retained pidfd match that separately pinned native executable. Operator argv
selects the install root; no production helper request can select this controller.
The future helper authority reader must derive its root from its own executable.

```text
workspacectl-init-trial-controller plan INSTALL_ROOT CANDIDATE INTENT
workspacectl-init-trial-controller issue INSTALL_ROOT CANDIDATE INTENT PLAN --approve DIGEST --operation-id ID
workspacectl-init-trial-controller reserve INSTALL_ROOT TRIAL_ID --approve DIGEST
workspacectl-init-trial-controller launch INSTALL_ROOT TRIAL_ID --approve DIGEST
```

`plan` is an explicit read-only full trial planning surface. It reads the already
provisioned candidate and intent using the exact encoding below, independently
captures every required resource and current environment, and derives the complete
plan using the same native policy/action/resource function used by issue/reserve.
It repeats captures and semantic comparison before returning canonical plan JSON.
It does not acquire/create registry or transaction locks, issue a trial, reserve an
attempt, generate intent, or invoke any candidate/helper. The plan remains
`executable:false`; later issuance still requires explicit digest approval.

The packed CLI exposes only this planning branch:

```text
workspacectl manifest-init-trial-plan --install-root DIR --candidate FILE --intent FILE
```

The CLI safely reads the independently provisioned fixed sidecar, verifies its
native controller bytes, and invokes exactly `plan DIR FILE FILE` with empty
environment and cwd `/`, bounded output and timeout. No public issue/reserve,
controller override, startup envelope, qualification or child-launch selector is
introduced. Native checks its own pinned executable witness and the anchor. This
read-only subprocess is not the future N-API authority transport. The older
`manifest-init-plan` preview and its wire remain unchanged. Stdout is the full
trial plan itself, suitable for retaining as the exact `PLAN` input below.

`issue` accepts only initial `apply` intent. It checks the complete input plan,
including its digest, against an explicit approval argument; there is no approval
default. The argument confirms exact plan content, not proof of human consent.
The operator remains responsible for obtaining approval of the specific fixture.
It returns the emitted CandidateTrial as JSON and exits 0 only after readback of
immutable registry records. The random trial ID is 32 bytes from `getrandom`,
encoded as 64 lowercase hex characters. The lifetime is fixed CLOCK_BOOTTIME,
same boot, at most ten minutes from issuance; reserve does not renew it.

`reserve` accepts only the fixed registry's retained ID, validates all retained
records and original inputs, repeats live capture and plan comparison under the
registry lock, and publishes one consumed/reserved attempt. On that successful
reservation it prints the reservation JSON, then **exits 3 with
`UNSUPPORTED_LAUNCH: attempt durably consumed; no child started`**. This is expected
fail-closed behavior, not a successful apply. Any retry of the ID refuses without
changing the fixture or existing registry records. Errors contain static categories,
not paths or captured input text. Stdout failure cannot undo consumption.

The registry descriptor remains owned through output and invocation exit, including
blocked output. `Completion` retains the close-on-exec flock guard and immutable
record witnesses. `reserve` still starts no children. `launch` performs the same
durable reservation then invokes only the candidate's pinned Node with exactly
`[node.path,"--require",launcher.path,engine.path+"/dist/cli.js"]`, empty environment,
cwd `/`, a private stdin pipe, bounded stdout and null stderr. No argv/command
array is accepted from an operator or helper message.

The cdylib is separately provisioned as `lib/init-launcher.node`, not loaded by
normal public CLI flags. Its N-API entry derives the install root using its actual
module location, verifies the live pinned native parent before reading the pipe,
and accepts exactly one bounded startup frame followed by EOF:

```text
{apiVersion:"workspace-governance/init-trial-startup-v1",
 trial:{path,sha256},reservation:{path,sha256}}
```

This is an **internal startup diagnostic**, not the frozen trial helper request or
begin protocol. Both paths must be the fixed registry names. Native reuses the
issuer's complete candidate/intent/plan/approval/receipt/index and under-registry-lock
recapture checks without issuing/reserving anything. It verifies the existing lock
contends (never creates it), live controller PID/start/boot via pidfd, exact Node
executable/argv/empty environment and parent chain, and fixed lifetime. Immutable
record descriptors survive through invocation and are rechecked; byte-identical
reservation replacement is stale. This remains the cooperative private-registry
model, not proof against a hostile same-UID process or filesystem atomicity.

Only after native admission is a no-argument, one-use callback installed for the
exact CLI. It starts only the pinned helper with `[helper.path,"--ipc-fd","3"]`,
empty environment, cwd `/`, null standard IO and the existing AF_UNIX/SOCK_STREAM
socketpair. All other inherited descriptors are close-on-exec. The helper derives
its own root and independently repeats admission, including Node/helper ancestry;
socket peer PID is correctly the Node creator. Ancillary data is refused on every
socket receive, including EOF. Output writes use nonblocking descriptors so a poll
deadline does not lead into an unbounded blocking write.

The helper returns only `{code:"UNSUPPORTED",stage:"TRIAL_ADMITTED_NO_TRANSACTION"}`.
The CLI prints it and exits 3; the controller requires those exact bytes/status.
This is not a transaction result, capability reply or evidence/ledger family. No
manifest, state, transaction lock, begin or passed qualification is produced.
The one-use callback is not a substitute for the still-missing one-begin state machine.

The controller is a subreaper; Node owns a private process group and both child
launches set parent-death SIGKILL with an immediate parent recheck. Startup/IPC is
bounded to 30 seconds and the fixed trial deadline is checked during supervision;
expiry cannot produce a successful diagnostic. Error shutdown uses TERM, five
seconds, then KILL and reaping, retaining the registry guard through Node and adopted
helper quiescence. Kernel wait after KILL can still block on an uninterruptible
kernel task; no timeout releases a lock as if that task had exited. These are
process-lifecycle checks, not transaction cancellation/durability qualification.

## Closed input encoding

JSON uses the existing native duplicate/prototype-key rejecting parser, canonical
JSON, SHA256 and bounded path conventions. Candidate/intent/plan input files and
each registry record are currently bounded to 262144 bytes. This issuance slice
fails closed on larger plans even though the eventual helper frame ceiling is
2 MiB. Hashes bind exact supplied bytes; plan `digest` binds canonical JSON without
the `digest` property. Registry JSON is canonical without LF; original candidate,
intent and plan captures retain their exact supplied bytes.

Candidate manifest concretizes the adopted contract's provenance/artifact list:

```text
{
 apiVersion:"workspace-governance/init-candidate-manifest-v1",
 classification:"development-candidate/pending",
 release:ID, abi:"linux-init-helper-v1", target:"linux-x86_64-glibc236",
 helperArchive:{path,sha256}, packedCli:{path,sha256},
 provenance:{source:{path,sha256},build:{path,sha256}},
 engine:{path,treeSha256,version},
 helper:{path,sha256,abi:"linux-init-helper-v1"},
 launcher:{path,sha256}, node:{path,sha256,version},
 capabilities:{path,sha256}, runtimeFiles:[{path,sha256}]
}
```

Every key shown is required; no unknown/null substitutes or passed claims. Versions
and release bindings are checked. Runtime references are nonempty, bytewise sorted,
duplicate-free, and must contain the launcher. Every declared artifact is safely
read/hash-bound with owner, mode, single-link and path/descriptor identity checks;
all are independently recaptured. Helper and Node must be executable x86-64 ELF64
files; the launcher must be an x86-64 ELF64 shared object. These header checks
reject known incompatible bytes but do not certify dependency closure or N-API ABI.
Fixed installation names are
`bin/workspacectl-init-helper`, `lib/init-launcher.node` and
`share/init-helper-capabilities.json`. The last file is parsed against the closed
init-only declaration and exact helper hash/release, not treated as a qualification.
The controller does not invoke helper capabilities or execute the Node version
string. Runtime ABI/version truth beyond these static bindings remains an audit gate.

The engine tree uses a bytewise-sorted relative path entry array, canonical-hashed:
regular files are `{path,kind:"file",sha256}`, directories are
`{path,kind:"directory"}`. The current implementation **refuses symlink trees**
rather than claiming the unimplemented resolved-target closure audit. It permits
at most 4096 entries, with the reused artifact component's stricter 512 file
references, 128 MiB individual and 256 MiB aggregate bound. Archive files and
source/build artifacts are identities, not assertions that extraction, full
runtime closure, reproducibility or native audit passed. Independent archive member
verification and closure audits remain mandatory before any future launch.

Intent is exactly:

```text
{apiVersion:"workspace-governance/init-trial-intent-v1",
 candidateManifestSha256, environment, fixture,
 limits:{maxBegins:1,maxActions:1,maxStageContainers:0}}
```

Environment and fixture use the adopted CandidateTrial shapes, including exact
DirectoryIdentity and request ResourcePrecondition. The issuer independently reads
boot/kernel/glibc, mount namespace, mountinfo and each involved writable mount.
`optionsSha256` hashes UTF-8 `mount-options + "\n" + super-options` from the selected
mountinfo line. Mount entries are sorted numerically and exactly cover the captured
fixture, state/manifest parents, evidence and registry mounts. Only supported local
ext4/xfs resources pass; no bind/nested/alias or permission-repair fallback exists.

The approved plan uses the adopted `init-trial-setup-plan-v1` family, its closed
`init-trial-setup-context-v1`, and trial executor binding. `executorProfilePath` in
this operator issuance input identifies the independently selected candidate
manifest, not a fabricated deployment profile. Executor binds exact candidate and
intent bytes. The initial manifest/action and normative closed init policy are
rederived with the existing native code and compared as canonical semantic values.
Context paths/nulls, authority/request/revision, actions/effects, bookkeeping and
both sorted sibling locks are independently checked. Self-consistent forged plan
hashes do not permit altered policy, payloads, effects, resources or destinations.

The resource set is derived, not accepted as a caller-chosen subset: exact request,
manifest/state occupancy, candidate/intent inputs, pinned controller/anchor,
registry/fixture/install and fixed install subdirectories, captured fixture parents
and evidence, engine root/tree and all measured artifact/engine files. Identity,
owner/group/mode/link/mount/hash facts are recaptured; absence has all-null facts.
Candidate artifacts/inputs cannot overlap the fixture parent or registry. Already
existing state requires ledger recognition and is refused by this initial-issuance
slice. No claim of complete transaction-state/recovery derivation is made.

## Immutable registry and interruption

All publication is exclusive 0600 temporary creation, file fsync, parent fsync,
`renameat2(RENAME_NOREPLACE)`, parent fsync and exact safe readback. No overwrite,
unlink, truncate, permission repair or reset operation exists.

The persistent registry lock is the existing strict
`.workspacectl-lock-<SHA256(exact registry path bytes)>` regular file. It is never
removed, replaced or truncated. Initial malformed/forged approval fails before
lock creation. A later stale input can leave the disclosed persistent lock, but
cannot produce a trial or transaction effect. Complete candidate/fixture/plan
checking repeats under this **registry** lock; this is not sorted transaction locks.

Retained paths for ID `T`:

- `T.candidate.json`, `T.intent.json`, `T.plan.json`: exact immutable captures.
- `T.inputs.json`: strict original candidate/intent/plan paths.
- `T.json`: the adopted CandidateTrial record, always pending, all twelve checks
  listed as pending and no passed assertions.
- `T.issued.json`: strict issuance receipt binding exact trial and input-map hashes.
- `operation-<SHA256(operationId)>.json` and `fixture-<SHA256(fixture path)>.json`:
  permanent initial-issuance indices binding trial ID, operation ID and approval.
- `T.reserved.json`: strict reservation tag, trial/hash, `state:"consumed/reserved"`,
  fresh random attempt ID, approval, current controller PID/start/boot and boottime.

Each has a fixed `.pending` exclusive publication temporary. Reserve requires all
eight immutable issuance components (trial, input map, three captures, receipt,
operation index and fixture index). It retains O_PATH file/parent witnesses and
compares safe bounded bytes, metadata, mount and named-path identity again under
the registry flock, including rejection of byte-identical inode replacement.
Before lock acquisition and again under lock, it inventories the exact recognized
issuance/capture/index pending names plus reservation final/pending names; any
present pending issuance component is contradictory and refuses without cleanup.
Missing or malformed final components also refuse. Unrelated trial IDs are not
interpreted as this trial's state.

This initial pending-only reader requires the exact ordered all-twelve pending
check set emitted by issue. A subset, duplicate, empty or reordered list is invalid,
not evidence of passed qualification. No broader family's future subset semantics
or launch authority is inferred.

An interrupted
reservation temporary is itself irrevocable consumption, even empty or malformed.
A missing or mismatched issuance receipt/index refuses reservation. Crashes during
issuance preserve partial records and permanently reserved indices; there is no
automatic retry/repair inference. New `apply` IDs cannot reuse the operation or
fixture. **Recovery issuance is not implemented**: the adopted new-ID/priorTrialId,
same-original-plan/fixture/candidate and explicit recover-approval rules remain a
required integration, not an invitation to delete indices or reuse an apply ID.

## Executed test boundary and remaining launch gates

`tests/controller_issuance.py` runs the actual compiled native executable in fresh
private fixtures selected by `WG_NATIVE_TEST_HARNESS`, with exact binary bytes from
`WG_TRIAL_CONTROLLER_BIN`. The approved harness supplies its Rust build outputs,
Node distribution/headers and local compiler. No production env selector is added.
The fixture builds and loads a real **deliberately fail-closed synthetic N-API
module**, packages synthetic artifacts and marks all checks pending. The fixture
capability data tests strict parsing, not the unchanged helper's actual begin
capability. This is not an exact release archive or fake qualified deployment.

With `WG_PACKED_CLI` selecting an exact retained npm archive, `packed-normal`
installs it offline without lifecycle scripts, verifies each member against the
installed engine, executes the installed npm bin, and compares the full native
plan to the unchanged independent Node policy/action oracle plus real resource
captures. Its exact stdout becomes the explicitly approved issuance input.
`packed-forged`, `packed-stale`, `packed-occupied`, `packed-issue-stale` and
`packed-issue-occupied` preserve whole-fixture snapshots on refusal. The native
helper/launcher candidate remains synthetic/pending: this is an exact packed CLI
planning/issuance consumer, not an exact released helper trial or apply.

The tests retain issuance/reservation records, full-fixture snapshots, malformed
and self-consistent forged binding refusals, actual concurrent/controller flock
contention, and one-use/ambiguous reservation refusals. An external ptrace observer
changes the target at the real registry-flock boundary to test under-lock recapture.
Another observer SIGKILLs the controller at its first stdout write, after durable
reservation/readback, verifies the registry lock is still held, and retries to prove
permanent consumption with unchanged retained fixtures. No fault hook is compiled
into the native executable. SIGKILL evidence is not power-loss qualification.

The `packed-launch*` cases replace the synthetic addon with the real built cdylib
and exercise exact offline npm installation, native startup and helper admission.
They retain exec argv/environment/FD observations, Node-death adoption with the
registry lock held, one-use refusal and occupied/stale/forged/pending/byte-identical
replacement probes at the actual Node exec boundary. These fixtures still use
synthetic pending capability/provenance/archive data for schema binding and are
not complete native release archives or truthful begin-capability declarations.

Before any begin/transaction is permitted, still implement and independently review:
the strict capabilities/request-number/one-begin/cancel protocol; complete exact
native archive/runtime closure and safe runtime/headroom admission; sorted transaction
locks and retained authority/resource checks at every effect gate; strict init-trial
capture/evidence/event/result families over shared reviewed transaction primitives;
terminal/cancel/status integration; new-ID recovery issuance; exact installed manifest
creation and later ordinary qualified consumer. The development transaction is
unchanged and is never linked or relabeled as a strict trial ledger here. Independent
review of this changed startup reader is required before acceptance.
