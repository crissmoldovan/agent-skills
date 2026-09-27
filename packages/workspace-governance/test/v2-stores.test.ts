import test from "node:test";
import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileCatalogStore,
  FileLocalStateStore,
  MemoryCatalogStore,
  MemoryLocalStateStore,
  StoreAdapterRegistry,
  writeCatalogDocument,
  writeLocalStateDocument,
  type CatalogStore,
  type DocumentRead,
  type LocalStateStore,
} from "../src/document-stores.ts";
import {
  ABSENT_REVISION,
  documentRevision,
  emptyCatalogDocument,
  emptyLocalStateDocument,
  validateCatalogDocument,
  validateLocalStateDocument,
  type CatalogDocument,
  type LocalStateDocument,
} from "../src/v2-model.ts";

const configPath = "/tmp/workspacectl-synthetic/config.yaml";
const configRevision = `sha256:${"a".repeat(64)}`;
const nextCatalog = (): CatalogDocument => ({
  ...emptyCatalogDocument(),
  metadata: { marker: "next" },
});
const initialState = () => emptyLocalStateDocument(configPath, configRevision);
const nextState = (): LocalStateDocument => ({
  ...initialState(),
  metadata: { marker: "next" },
});

class IndependentAsyncCatalogAdapter implements CatalogStore {
  #document: CatalogDocument | null = null;
  async #tick(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  async read(): Promise<DocumentRead<CatalogDocument>> {
    await this.#tick();
    return {
      document: this.#document === null ? null : structuredClone(this.#document),
      revision: this.#document === null ? ABSENT_REVISION : documentRevision(this.#document),
      capabilities: { read: true, compareAndSwap: "supported" },
      freshness: "current",
    };
  }
  async compareAndSwap(expectedRevision: string, nextDocument: CatalogDocument) {
    await this.#tick();
    const current = await this.read();
    if (current.revision !== expectedRevision) {
      const error = new Error("conflict") as Error & { code: string };
      error.code = "CONFLICT";
      throw error;
    }
    this.#document = validateCatalogDocument(nextDocument);
    return { revision: documentRevision(this.#document) };
  }
}

class IndependentAsyncLocalStateAdapter implements LocalStateStore {
  #document: LocalStateDocument | null = null;
  async #tick(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  async read(): Promise<DocumentRead<LocalStateDocument>> {
    await this.#tick();
    return {
      document: this.#document === null ? null : structuredClone(this.#document),
      revision: this.#document === null ? ABSENT_REVISION : documentRevision(this.#document),
      capabilities: { read: true, compareAndSwap: "supported" },
      freshness: "current",
    };
  }
  async compareAndSwap(expectedRevision: string, nextDocument: LocalStateDocument) {
    await this.#tick();
    const current = await this.read();
    if (current.revision !== expectedRevision) {
      const error = new Error("conflict") as Error & { code: string };
      error.code = "CONFLICT";
      throw error;
    }
    this.#document = validateLocalStateDocument(nextDocument);
    return { revision: documentRevision(this.#document) };
  }
}

async function catalogConformance(store: CatalogStore): Promise<void> {
  const absent = await store.read();
  assert.equal(absent.document, null);
  assert.equal(absent.revision, ABSENT_REVISION);
  assert.deepEqual(absent.capabilities, { read: true, compareAndSwap: "supported" });
  assert.equal(absent.freshness, "current");

  const next = nextCatalog();
  const written = await writeCatalogDocument(store, ABSENT_REVISION, next);
  assert.equal(written.revision, documentRevision(next));
  assert.deepEqual(written.document, next);
  written.document!.metadata.marker = "caller edit";
  assert.deepEqual((await store.read()).document, next);

  await assert.rejects(() => writeCatalogDocument(store, ABSENT_REVISION, emptyCatalogDocument()), {
    code: "CONFLICT",
  });
  assert.deepEqual((await store.read()).document, next);
}

async function localStateConformance(store: LocalStateStore): Promise<void> {
  const absent = await store.read();
  assert.equal(absent.document, null);
  assert.equal(absent.revision, ABSENT_REVISION);
  const next = nextState();
  const written = await writeLocalStateDocument(store, ABSENT_REVISION, next);
  assert.equal(written.revision, documentRevision(next));
  assert.deepEqual(written.document, next);
  await assert.rejects(() => writeLocalStateDocument(store, ABSENT_REVISION, initialState()), {
    code: "CONFLICT",
  });
  assert.deepEqual((await store.read()).document, next);
}

test("M2 catalog and local-state memory stores have defensive read/write/CAS semantics", async () => {
  await catalogConformance(new MemoryCatalogStore());
  await localStateConformance(new MemoryLocalStateStore());
});

async function concurrentSameRevisionConformance<T>(
  store: {
    compareAndSwap(expectedRevision: string, nextDocument: T): Promise<{ revision: string }>;
  },
  nextDocument: T,
): Promise<void> {
  const attempts = await Promise.allSettled([
    store.compareAndSwap(ABSENT_REVISION, nextDocument),
    store.compareAndSwap(ABSENT_REVISION, nextDocument),
  ]);
  assert.equal(
    attempts.filter((attempt) => attempt.status === "fulfilled").length,
    1,
    "exactly one in-memory CAS may claim a shared base revision",
  );
  const rejected = attempts.find((attempt) => attempt.status === "rejected");
  assert.equal(rejected?.status, "rejected");
  assert.equal((rejected as PromiseRejectedResult).reason?.code, "CONFLICT");
}

test("M2 catalog and local-state memory CAS atomically reject a second shared-base write", async () => {
  await concurrentSameRevisionConformance(
    new MemoryCatalogStore(),
    emptyCatalogDocument(),
  );
  await concurrentSameRevisionConformance(
    new MemoryLocalStateStore(),
    initialState(),
  );
});

test("M2 independently implemented async adapters satisfy and register through the public boundary", async () => {
  const catalog = new IndependentAsyncCatalogAdapter();
  const localState = new IndependentAsyncLocalStateAdapter();
  const registry = new StoreAdapterRegistry();
  registry.registerCatalog("async-test", () => catalog);
  registry.registerLocalState("async-test", () => localState);
  assert.equal(registry.createCatalog("async-test", "opaque-test-location"), catalog);
  assert.equal(registry.createLocalState("async-test", "opaque-test-location"), localState);
  await catalogConformance(catalog);
  await localStateConformance(localState);
  assert.throws(() => registry.createCatalog("repository/module/path", "x"), {
    code: "UNSUPPORTED",
  });
});

test("M2 file stores use private atomic documents and preserve bytes on stale CAS", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-v2-store-"));
  try {
    const catalogPath = join(root, "catalog.json");
    const statePath = join(root, "local-state.json");
    await catalogConformance(new FileCatalogStore(catalogPath));
    await localStateConformance(new FileLocalStateStore(statePath));
    assert.equal((await stat(catalogPath)).mode & 0o777, 0o600);
    assert.equal((await stat(statePath)).mode & 0o777, 0o600);
    const catalogText = await readFile(catalogPath, "utf8");
    assert.doesNotThrow(() => JSON.parse(catalogText));
    assert.deepEqual(
      (await readdir(root)).sort(),
      ["catalog.json", "local-state.json"],
      "private temporaries and owned locks must be removed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M2 unknown and apparently stale file locks return BUSY without deletion or mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-v2-busy-"));
  try {
    for (const [name, lockBytes] of [
      ["unknown", "not-a-lock\n"],
      ["stale", JSON.stringify({ schemaVersion: 1, nonce: "other", pid: 999999, createdAt: "2000-01-01T00:00:00.000Z" }) + "\n"],
    ] as const) {
      const path = join(root, `${name}.json`);
      const store = new FileCatalogStore(path);
      await writeCatalogDocument(store, ABSENT_REVISION, emptyCatalogDocument());
      const before = await readFile(path);
      const lock = `${path}.lock`;
      await writeFile(lock, lockBytes, { mode: 0o600 });
      await chmod(lock, 0o600);
      assert.equal((await store.read()).revision, documentRevision(emptyCatalogDocument()), "reads do not lock");
      await assert.rejects(
        () => writeCatalogDocument(store, documentRevision(emptyCatalogDocument()), nextCatalog()),
        { code: "BUSY" },
      );
      assert.deepEqual(await readFile(path), before);
      assert.equal(await readFile(lock, "utf8"), lockBytes);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M2 stale, unknown, and read-only snapshots cannot authorize a write", async () => {
  let called = false;
  const fake = (
    compareAndSwap: "supported" | "read-only" | "unknown",
    freshness: "current" | "stale" | "unknown",
  ): CatalogStore => ({
    async read() {
      return {
        document: emptyCatalogDocument(),
        revision: documentRevision(emptyCatalogDocument()),
        capabilities: { read: true as const, compareAndSwap },
        freshness,
      };
    },
    async compareAndSwap() {
      called = true;
      return { revision: documentRevision(nextCatalog()) };
    },
  });
  for (const [capability, freshness, code] of [
    ["read-only", "current", "UNSUPPORTED"],
    ["unknown", "current", "UNTRUSTED_INPUT"],
    ["supported", "stale", "UNTRUSTED_INPUT"],
    ["supported", "unknown", "UNTRUSTED_INPUT"],
  ] as const) {
    called = false;
    await assert.rejects(
      () => writeCatalogDocument(
        fake(capability, freshness),
        documentRevision(emptyCatalogDocument()),
        nextCatalog(),
      ),
      { code },
    );
    assert.equal(called, false);
  }
});
