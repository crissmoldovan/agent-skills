import test from "node:test";
import assert from "node:assert/strict";
import {
  ABSENT_REVISION,
  MemoryCatalogStore,
  MemoryLocalStateStore,
  StoreAdapterRegistry,
  documentRevision,
  emptyCatalogDocument,
  emptyLocalStateDocument,
  writeCatalogDocument,
  writeLocalStateDocument,
  type CatalogDocument,
  type CatalogStore,
  type LocalStateStore,
} from "../src/index.ts";

test("M2 package API exposes independent catalog and local-state store contracts", async () => {
  const catalogDocument: CatalogDocument = emptyCatalogDocument();
  const catalog: CatalogStore = new MemoryCatalogStore();
  const stateDocument = emptyLocalStateDocument(
    "/synthetic/config.yaml",
    documentRevision({ synthetic: "config" }),
  );
  const state: LocalStateStore = new MemoryLocalStateStore();
  const writtenCatalog = await writeCatalogDocument(
    catalog,
    ABSENT_REVISION,
    catalogDocument,
  );
  const writtenState = await writeLocalStateDocument(
    state,
    ABSENT_REVISION,
    stateDocument,
  );
  assert.equal(writtenCatalog.document?.documentType, "workspacectl/catalog");
  assert.equal(writtenState.document?.documentType, "workspacectl/local-state");

  const adapters = new StoreAdapterRegistry();
  adapters.registerCatalog("synthetic", () => catalog);
  adapters.registerLocalState("synthetic", () => state);
  assert.equal((await adapters.createCatalog("synthetic", "unused").read()).revision, writtenCatalog.revision);
  assert.equal((await adapters.createLocalState("synthetic", "unused").read()).revision, writtenState.revision);
});
