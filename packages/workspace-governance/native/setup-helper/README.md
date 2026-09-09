# Native setup components and read-only init helper

This directory is **not a complete setup executor or qualified writer release**.
There is no supervisor, N-API authority launcher, capability declaration, qualification
record, clone executor or production operation journal yet. The installed CLI now
executes the separate `workspacectl-init-helper` target for read-only preview semantic
verification only. It does not link or invoke the development transaction writer.
A development-only transaction engine now creates real synthetic manifests and a
separate, explicitly nonproduction ledger (see below).
Do not treat passing component tests as permission to run scaffold mutations.

Implemented components:

- Literal GitHub C-locale askpass prompt parsing.
- A standalone askpass bridge using inherited Unix-stream fd4, bounded frames,
  same-UID peer check, ancillary-data refusal and static silent failure.
- Core-dump disabling and explicit wiping of the bridge-owned response allocation.
- Internal no-follow directory traversal and `renameat2(RENAME_NOREPLACE)` primitive.
- Persistent descriptor-owned `flock` primitive: strict derived lock basenames,
  exclusive 0600 creation, existing single-link regular-file/owner/mode checks,
  no-follow identity revalidation, file/parent fsync, and close-on-exec descriptors.
  Release closes the descriptor without unlinking or rewriting the lock file.
  Real subprocess tests check contention and descriptor noninheritance. This does
  not yet implement sorted resource-lock acquisition or supervisor lifetime ownership.
- Independent bounded Rust init-request validation and canonical manifest-v1 byte
  derivation, including legacy UTF-16 escaped lone-surrogate and Unicode scalar key
  ordering semantics and ECMAScript-compatible finite number serialization.
- Independent init `file.create` payload/action-ID derivation and complete action
  comparison against independently supplied request/target/current bytes. Exact
  existing bytes yield an inert null action; different bytes refuse. These pure
  functions do **not** recapture files or validate the enclosing v2 plan, approval,
  resource preconditions, executor qualification, locks or journal. They enable no
  writes. Differential tests compare the unchanged Node authoring implementation
  and the separate Node action derivation with the Rust implementation.

The bridge does not acquire credentials. The future supervisor must enforce the
approved URL, live clone relationship, single username/password exchange, channel
lifetime, cancellation and reaping. Its own allocation wiping does not prove that
trusted Git or OS buffers have been erased. The directory primitive does not yet
perform complete mount, resource-identity, policy or journal revalidation.

## Trial trust/capture primitives

`src/init_trial.rs`, exposed internally through `init::trial`, implements the frozen
sidecar shape and descriptor-based measurements needed by the bounded candidate
mechanism. Its measurement functions do not grant authority. The separately pinned
operator executable below reuses them to issue registry records; the helper's
read-only dispatcher is unchanged.

- `read_trust` uses only `operator/init-trial-trust-v1.json` beneath an independently
  selected installation root. Strict JSON/keys/decimal/mode/hash validation, private
  ancestry, no-follow/O_PATH preinspection, single links, descriptor/path identity,
  bounded bytes and freshly measured controller hashes/registry/fixture identities
  fail closed. Its output is measured data, **not an execution grant**. The eventual
  native authority caller must derive the root from its actual executable, not input.
- `capture_fixture` validates the exact trial fixture/request-resource shape and
  independently reads request bytes, owner/mode/link/device/inode/mount facts. It
  rejects traversal, overlapping parents, evidence overlapping the anchor/registry,
  same-byte inode substitution, unsupported/bind-alias/nested mounts and changed
  mountinfo. It repeats captures but currently runs **without transaction locks**.
- `ControllerWitness` binds a real native ELF executable/path/hash, same UID,
  parent/start/boot facts and retained pidfd; rechecks reject process exit or drift.
  It is not the issuing controller and does not yet bind the Node/CLI/helper chain.
- `TrialLifetime` checks the strict fixed lifetime against CLOCK_BOOTTIME, rejects
  future/expired/over-ten-minute intervals and retains its original boot/deadline.
  A valid interval does not authenticate an issuer or approval.
- `CandidateFiles` strictly measures sorted `{path,sha256}` artifact arrays and
  rechecks file identities and bytes. It checks declared files, **not full runtime
  closure, the complete candidate manifest, engine-tree digest or archive equality**.
  Component ceilings are 512 references, 128 MiB per artifact and 256 MiB total.

Tests use newly allocated private leaves. The trust parsing fixture's inert
controller bytes are never executed or called a valid issuer. A separate real native
test child verifies the process witness. Synthetic mount tables test parser/alias
refusals without mounting anything; live fixture capture separately reads procfs.
No candidate trust anchor is provisioned for the installed production helper by
these tests. No test environment selector is linked into its dispatcher.

## Native operator trial issuer (registry writes only)

The real `workspacectl-init-trial-controller` target issues immutable, pending
CandidateTrial records after explicit complete-plan digest approval. `reserve`
revalidates the bindings and durably consumes one attempt under the persistent
registry flock. It then exits 3 with `UNSUPPORTED_LAUNCH`; it cannot launch a child
or invoke the transaction writer. A crash after reservation never permits retry.

The native issuer strictly checks candidate/intent/trial shapes, declared installed
files and a regular-file engine tree, live environment/fixture identities, the
init policy/action, full approved plan fields and its independently derived
issuance resource set. Capture and plan comparison repeat under the **registry**
lock. This is not the missing sorted **transaction** lock/authority boundary.
All qualification checks remain pending; no report or apply result is synthesized.

See [TRIAL-CONTROLLER.md](TRIAL-CONTROLLER.md) for the operator interface, strict
input encoding, retained crash states and test classification. The executable
fixtures exercise actual issuing/reserving code against deliberately incomplete
synthetic candidates, not a qualified production archive or installed trial apply.

Still required: exact release/runtime/archive closure, N-API ancestry startup and
supervisor, sorted transaction locks with full native admission, production
ledger/cancel/recovery integration, explicitly new-ID recovery issuance and exact
installed approved apply/recovery. Deployment and full scaffold gates remain open.

## Explicit developer prerequisites

Use a separately provisioned Rust **1.85.1** compiler/cargo and native Linux linker.
`Cargo.lock` pins registry checksums for `libc` **0.2.171**, `ryu-js` **1.0.2**,
`sha2` **0.10.8**, `base64` **0.22.1** and their transitive dependencies. The pure
native derivation uses no Node callback. Only its test oracle requires the explicit
`WG_NATIVE_NODE` path to a separately approved Node **>=24** executable.
The development build was exercised with GCC **14.2.0** and GNU ld **2.44**.
This is not a reproducible release/build attestation or a glibc compatibility test.

Set these variables to separately approved private locations; never point writer
fixtures beneath group/world-writable ancestry or change existing directory modes:

```sh
PATH="$RUST_PREFIX/bin:/usr/bin:/bin" \
RUSTUP_HOME="$PRIVATE_RUSTUP_HOME" \
CARGO_HOME="$PRIVATE_CARGO_HOME" \
CARGO_TARGET_DIR="$PRIVATE_BUILD_ROOT/target" \
WG_NATIVE_TEST_ROOT="$PRIVATE_FIXTURE_ROOT" \
WG_NATIVE_NODE="$QUALIFIED_NODE_PREFIX/bin/node" \
cargo test --locked --manifest-path native/setup-helper/Cargo.toml \
  --lib --bins --test prompt --test bridge --test filesystem --test locks --test init_authoring
```

Run from the governance package directory. Fixtures are synthetic and retained.
Native tests do not run automatically through the existing read-only npm verifier.
There are no npm install hooks, runtime downloads or runtime compilation paths.

## Read-only executable planning boundary

Build with the same explicitly provisioned offline toolchain:

```sh
cargo build --locked --offline --release --bin workspacectl-init-helper
cargo test --locked --offline --release --test init_preview
```

`src/init_helper.rs` accepts only `--ipc-fd 3`, an empty environment and one private
AF_UNIX/SOCK_STREAM endpoint with same-UID parent peer. It closes extra inherited
FDs, disables core dumps, refuses ancillary descriptors at header/body/EOF and
requires one bounded frame plus EOF within five seconds. It opens only its own
executable for hashing; no target or state path is opened. The host imposes a
seven-second process deadline and pins the separately provisioned helper bytes.

`src/init_preview.rs` is a child module of the existing authoring engine, reusing
its parser, canonicalization, SHA256 and manifest/action derivation. It compares
the complete **preview** (including proposed policy/provenance, raw request digest,
explicit paths and actual helper hash), not the full production resource plan.
Tags are `init-preview-helper-request-v1` and `init-preview-plan-v1`; no production
capabilities or mutation authority are claimed. Apply/recover refuse unconditionally.
The installed command/profile/output and remaining authority gates are documented
in the package README. Node's built-in private socketpair is only a read-only
precursor; it does not claim the frozen N-API supervisor/authority ABI.

## Development transaction boundary

`src/init_transaction.rs` is source-included only by the transaction and boundary
integration tests. It is
absent from `lib.rs`, binary declarations, CLI commands and npm exports. No public
flag, environment variable, qualification record or capability permits invoking it.
The test executable uses explicit external candidate SHA256 pinning and a separately
approved private fixture parent; its test-only environment selectors are not read
by any production dispatcher. A hostile same-UID caller is not sandboxed by this
source boundary. Never install the test executable as a production helper.

An external controller must first build `cargo test --locked --release --test
init_transaction --no-run`, retain/hash the exact executable, then execute that
binary with `WG_INIT_CANDIDATE_SHA256` equal to that independently recorded hash,
`WG_NATIVE_TEST_ROOT` fixed to the approved disposable fixture parent, and
`WG_NATIVE_NODE` fixed to the provisioned Node. Tests verify their own executable
hash. No prior successful consumer or fabricated passed qualification is needed.
The controller must retain candidate/source identities, exact command/exits/logs
and fixture paths. Hash pinning identifies a candidate; it does not qualify it.

The shared native development engine derives a real legacy manifest and rootless
state, takes sorted persistent locks for fixed manifest/operation paths, uses
exclusive 0600 temporaries and no-replace publication with file/parent fsync, and
retains immutable hash-linked development records. Manifest and result publication
have prepublication inode evidence. Replay revalidates bytes/identities and fsyncs
without replacing terminal artifacts. Identical preexisting manifest bytes receive
a no-op ledger. Different occupied bytes refuse before lock creation. Test callbacks
permit actual process SIGKILL boundaries in the external executable only.

The ledger tag is `workspace-governance/development-init-record-v1`, NOT the
production init journal/result schema. Each fresh disposable control root hosts
one fixed `operation` directory. Unknown/partial allocation ownership is refused
without cleanup; proven allocation/publication and terminal tails can recover.
The tests include a real legacy CLI validator readback, occupied/racing targets,
completed replay, byte tampering, inode replacement (including candidate-only
crash), and process-crash recovery. Early bootstrap and temporary-before-identity
crashes remain conservative failures, not guessed resumptions.

Remaining release work includes full independently rederived plan/context/resource
approval, production IPC/launcher/supervisor/cancellation/status, strict wire and
bookkeeping/evidence schema integration, full path/mount/alias/runtime closure,
complete error/deadline/space and every-boundary fault coverage, no-op incomplete-tail
recovery, archive qualification and independent review. The development engine is
not permission to skip these gates or a claim of hostile-writer safety. In particular,
actual SIGKILL is process-crash evidence, **not power-loss filesystem qualification**.
The archived-production-CLI bootstrap has a separately adopted bounded operator
candidate-trial contract; its strict authority reader/controller/issuer and exact
archive integration are not implemented here. This development transport does not
satisfy that contract. Production apply still requires truthful full qualification.

## Development Node/native executable boundary

`tests/init_boundary.rs` externally drives `tests/development-init-cli.mjs` with
`plan`, `verify <exact-plan-bytes>`, and `apply <exact-plan-bytes> <sha256>` commands.
The development test controller supplies fixed fixture/helper/runtime selectors;
ordinary `workspacectl` has no new command or bypass. Build this separate test with
`cargo test --locked --release --test init_boundary --no-run`, externally retain
and pin the resulting executable, then run it with the same approved prerequisite
variables described above. The Node script is test source, excluded from npm files.

The real Node process sends a bounded four-byte-big-endian frame over inherited
fd3 to a distinct native process. The source-included native adapter independently
captures fixed request/manifest/root facts and rederives the complete **development**
plan (action, candidate hash and context). Exact canonical bytes are mandatory;
self-consistent forged plan digests, changed request inode and wrong approvals
refuse before transaction locks. Success invokes the shared transaction engine,
not a mock filesystem. Responses say `development-candidate`, `deployable:false`.
Tests also bypass Node deliberately to verify native rejection, fragment frames,
pass actual SCM_RIGHTS, and check identical-manifest no-op and real publication.

This is a single-request development IPC adapter, **not the N-API launcher or
production supervisor**. Frame bodies are development command/approval/canonical
plan bytes separated by LF, not the init-helper JSON envelope. The peer must close
its write half before effects. Fragmented receive has a five-second total deadline;
ancillary descriptors, trailing bytes and malformed/oversized input refuse. No
concurrent cancel, controller ancestry authentication, post-begin disconnect
shutdown, status/recover CLI, complete mount/runtime closure, production wire
schema or under-lock full ResourcePrecondition rederivation is claimed. The Node
test launcher inherits the controller environment and uses libtest dispatch;
production must not reuse that launch policy or test environment authority. CLI
argument size is also subject to OS argv bounds; this is not the production large
plan transport. Passing these tests does not implement the adopted trial authority.

## Recovery inventory correction

Replay validates recognized final/pending/staging terminal paths before effects.
Orphan result identities, unsupported pending results and interrupted staging
files refuse conservatively; fresh orphan bookkeeping refuses before lock creation.
No-op and create inventories are mutually exclusive. Regression assertions compare
the entire fixture's path set, bytes, devices, inodes and modes after refusal.
The quiescent-owner assumption remains: split directory handles and same-owner
concurrent namespace replacement have not been hardened into a sandbox guarantee.

Before any release, complete the supervisor/launcher, exact v2 protocol and shared
semantic derivation, authenticated real-Git qualification, durability/recovery
matrix, native audit, reproducible complete archive and independent consumer tests.
