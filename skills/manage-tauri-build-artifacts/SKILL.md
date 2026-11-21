---
name: manage-tauri-build-artifacts
description: "Manage Tauri build and verification artifacts across frontend output, native builds, and desktop packages. Use when packaging or testing a Tauri app, investigating large bundle output, or preparing a clean Tauri rebuild."
license: MIT
compatibility: "Requires the project's Tauri and frontend tools and local file access. Use manage-workspace-storage for run custody and manage-rust-build-artifacts for Cargo output."
metadata: { "group": "workflow", "lifecycle": "release", "version": "1.0.0", "author": "crissmoldovan" }
---

# Manage Tauri build artifacts

## When to Use

Use for Tauri builds, app and installer packaging, and tests against a packaged app. Load
`manage-workspace-storage` for worktrees, scratch, evidence and cleanup. Load
`manage-rust-build-artifacts` for Cargo targets and compiler files.

## Prerequisites

1. **Identify the actual packaging path.** Read the project's Tauri configuration and
   build invocation. Locate the frontend build command and its output, Cargo target, bundle
   formats, and any test profiles or temporary copies the verifier creates.
   **Complete when:** each path is classified as an original input, run output, or retained deliverable.

## Procedure

1. **Keep each output under one run.** Point the frontend, Cargo and packaging steps at that
   run's scratch where the project supports those overrides. For fixed paths record the exact
   generated directories and check they are empty or available for the run. Keep originals
   such as source assets, signing inputs and sidecar sources separate.
   **Complete when:** the actual paths fit the run's budget and no live run shares a disposable path.
2. **Test the exact package.** Identify the bundle, target, profile, source revision and any
   separately served frontend used during verification. Record the app or installer's identity
   before testing it. If another test needs this exact package, pin its path, checksum, consumer
   and release condition. Move an authorized deliverable to durable storage if its consumers
   can follow it.
   **Complete when:** one package and frontend can be traced to the result, and each retained copy has a consumer.
3. **Retire after the last consumer.** Quit the packaged app and confirm its helpers, frontend
   server, runner and packager are closed. Confirm any test data cleanup and retain the required
   result outside scratch. Retire the run's bundles, installers, temporary app copies and
   frontend output through the shared closeout. Apply it after an unsuccessful test as well.
   Close out the prior run before building again into empty output.
   **Complete when:** only named deliverables or pending inputs remain and their release conditions are recorded.

## Usage Examples

```text
Use manage-tauri-build-artifacts for the packaged desktop check. Record the exact bundle and retire disposable outputs when the run closes.
```

## Pitfalls

- A finished bundler does not mean that the app or its helper processes have closed.
- Tauri's bundle and installer paths vary with platform and build options. Verify what the actual invocation emitted. [Tauri distribution guide](https://v2.tauri.app/distribute/)

## Verification

- [ ] The verification used the exact recorded bundle and frontend inputs.
- [ ] Owned app and test processes are closed, and fixture cleanup is confirmed.
- [ ] The generated outputs were retired under the generic closeout, with active pins recorded separately.
