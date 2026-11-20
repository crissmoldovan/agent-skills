# Tauri and Rust build outputs

Apply this workflow to Cargo builds, tests, Tauri bundling, and packaged desktop verification.
The run's generated outputs are disposable after closure, whether the result passes or fails.

1. **Start in an empty target.** Use the [storage start command](commands.md) with a dedicated
   project scratch root and a run purpose. Put `CARGO_TARGET_DIR` under the returned `work`
   directory and pass that environment to Cargo and the Tauri build command. Configure any
   frontend build and standalone packaging output in the same run where the project permits.
   When an existing verifier needs fixed paths, record the exact generated directories and
   verify they're vacant or empty at launch. Keep shared `CARGO_HOME`, toolchains, registries,
   and current dependencies separate from the disposable target.
2. **Retain a small result.** Save the source revision, build command, result, and logs or
   screenshots needed to explain it in the durable evidence destination. When a subsequent
   check explicitly pins an executable or bundle, record its exact path, consumer, and release
   condition. Keep protected assets and evidence outside the disposable tree when their
   consumer permits relocation. If a pin requires the original path, retire the surrounding
   generated outputs within the approved scope and retire the pinned output after release.
3. **Close and retire.** Verify the build, test, app, and their owned child processes are
   terminal, and confirm the evidence reads back. Retire the owned output as part of the run's
   closeout under its authorized scratch scope. Use the [cleanup command](commands.md) for
   managed scratch. A failed build has the same closeout requirement. A stopped or interrupted
   job needs a verified terminal state before retirement.
4. **Rebuild cleanly.** Complete the preceding run's closeout first, then start an empty
   target for the rebuild. A target held live or by an exact pin belongs to that run. Use a
   separate empty target if that consumer still needs its copy.

Review legacy outputs by their exact paths, closure receipts and current consumers. Keep
active work, recent shared caches, source checkouts, pinned artifacts and other projects'
paths outside that review.
