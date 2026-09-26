# M3/A17 replaceable-storage contract

`CatalogStore` and `LocalStateStore` are asynchronous public interfaces. A read returns one coherent snapshot:

```ts
{
  document: T | null;
  revision: string;
  capabilities: { read: true; compareAndSwap: "supported" | "read-only" | "unknown" };
  freshness: "current" | "stale" | "partial" | "offline" | "unknown";
}
```

A write is `compareAndSwap(expectedRevision, nextDocument)` and returns the new revision. The catalog document contains catalog, policy, instruction, reference, and workflow records together. Adapters must not merge those records from independent revisions.

## Authority and selection

`StoreAdapterRegistry` is the trust boundary. Callers install factories under validated names before reading a configuration. Configuration selects only a name and an opaque absolute location. It cannot supply an executable module path, authentication claim, factory, credential, or capability override. Unknown names return `UNSUPPORTED`; path-like names and extra fields are invalid.

The CLI registry contains:

- `file`: the production local file adapter;
- `test-async-file`: a deliberately labelled local test adapter used to prove asynchronous named selection in packaged CLI tests.

`test-async-file` is not remote storage, authentication, distributed locking, an offline queue, or a production backend. `MemoryCatalogStore` and `MemoryLocalStateStore` are public library test/application primitives but are not process-global CLI adapters.

## Mutation rules

A preview that could authorize a catalog or local-state mutation requires a complete current snapshot for every prerequisite and `compareAndSwap: "supported"` on the selected mutation target. Read-only mutation targets return `UNSUPPORTED`. Stale, partial, offline, unknown-freshness, unknown-capability, or malformed authority returns `UNTRUSTED_INPUT`. Workspace export, validation, planning, apply, CAS, and postwrite readback all use the configured registry; a named non-file adapter never falls back to `FileCatalogStore` or `FileLocalStateStore`. Apply repeats authority, revision, plan, approval, and exact selected-target readback checks.

A losing catalog or local-state CAS returns `CONFLICT` and preserves the winning coherent document exactly. The public mutation path does not retry against a changed revision, select a fallback adapter, split catalog/rule/workflow writes, or report success before exact readback.

File stores use a private sibling lock, private temporary file, atomic rename, and exact readback. Unknown or apparently stale lock ownership returns `BUSY` without deleting the lock. Reads do not acquire mutation locks.

## Parity

The conformance suite runs file stores, memory stores, and an independently implemented asynchronous adapter through the public interfaces. For identical documents it compares catalog listing, context/rule/workflow resolution and provenance, catalog editing, workspace/local-state export and validation, edit preview/apply/CAS, conflict behavior, and exact selected-target readback. Adapter location and revision metadata are the only documented representation differences.
