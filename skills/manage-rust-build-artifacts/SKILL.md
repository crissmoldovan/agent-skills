---
name: manage-rust-build-artifacts
description: "Manage disposable Rust and Cargo build artifacts. Use before Cargo builds or tests, when target and incremental output grows, or when cleaning up a closed Rust verification run and preparing a clean rebuild."
license: MIT
compatibility: "Requires the project's Cargo toolchain and local file access. Use manage-workspace-storage for the shared scratch and closeout procedure."
metadata: { "group": "workflow", "lifecycle": "release", "version": "1.0.0", "author": "crissmoldovan" }
---

# Manage Rust build artifacts

## When to Use

Use for Cargo builds, tests, documentation, or native component verification that creates
disposable compiler output. Load `manage-workspace-storage` for worktree custody, resource
admission, evidence, and authorized removal. `manage-tauri-build-artifacts` covers the app
bundle and frontend when this build is part of a Tauri app.

## Prerequisites

1. **Identify the workspace and toolchain.** Locate the Cargo workspace, its selected toolchain,
   build profile and target, and any project or environment overrides for the output paths.
   **Complete when:** the effective output locations and any existing shared users are known.

## Procedure

1. **Put compiler output in the run's scratch space.** Set `CARGO_TARGET_DIR` to an empty
   directory inside the run's owned scratch space and pass it to every Cargo command and
   subprocess that needs it. If a distinct Cargo build directory is configured, put it under
   the same run using the configuration supported by that toolchain. Check the effective
   paths again before starting nested commands or cross-target builds.
   **Complete when:** both final and intermediate compiler writes have known destinations.
2. **Keep shared inputs separate.** Keep `CARGO_HOME`, registry and Git source caches, the
   Rust toolchain and shared compiler caches under their existing owners. Record the commit,
   command, target/profile and result. If another run needs an exact binary or library,
   record its path, consumer and release condition in the run's evidence.
   **Complete when:** a reviewer can reproduce the run from durable inputs and find each pin.
3. **Close and retire.** Let Cargo, tests, build scripts and owned child processes exit.
   Apply the generic closeout to the run's targets after either result. Retire the previous
   disposable output before a clean rebuild. Use another empty target if a pending consumer
   still needs the previous path.
   **Complete when:** the run's unneeded compiler output is gone and the retained evidence reads back.

## Usage Examples

```text
Use manage-rust-build-artifacts for this Cargo test run. Keep the target in owned scratch and retire it at closeout.
```

## Pitfalls

- A workspace-local `target` can still serve more than one command or worktree. Check ownership and pending consumers first.
- Cargo can separate final outputs from intermediates. Check both locations against the running toolchain. [Cargo build cache](https://doc.rust-lang.org/cargo/reference/build-cache.html)

## Verification

- [ ] All Cargo output paths are inside the run's scope or covered by a named exception.
- [ ] Required input caches and pinned binaries remain available for their current consumers.
- [ ] The generic closeout has recorded closure, retained evidence, and reclaimed space.
