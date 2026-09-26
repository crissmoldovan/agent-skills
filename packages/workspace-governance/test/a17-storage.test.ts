import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ABSENT_REVISION,
  FileCatalogStore,
  FileLocalStateStore,
  MemoryCatalogStore,
  MemoryLocalStateStore,
  StoreAdapterRegistry,
  createBuiltinStoreRegistry,
  createCatalogOperationPlan,
  createPrimarySelectionPlan,
  createWorkspaceChangePlan,
  applyWorkspacePlan,
  documentRevision,
  emptyLocalStateDocument,
  exportLocalStateDraft,
  listCatalog,
  readSelectedRegistry,
  resolveCatalogContext,
  validateCatalogDocument,
  validateConfigDraftFile,
  validateLocalStateDocument,
  writeCatalogDocument,
  writeLocalStateDocument,
  type CatalogDocument,
  type CatalogStore,
  type DocumentRead,
  type LocalStateDocument,
  type LocalStateStore,
} from "../src/index.ts";

const sha = (character: string) => `sha256:${character.repeat(64)}`;

function catalog(marker = "initial"): CatalogDocument {
  return validateCatalogDocument({
    schemaVersion: 2,
    documentType: "workspacectl/catalog",
    groups: [
      { id: "org", kind: "organization", name: "Org", slug: "org", parentId: null, metadata: {} },
      { id: "project", kind: "project", name: "Project", slug: "project", parentId: "org", metadata: {} },
    ],
    sources: [],
    repositories: [{
      id: "repo",
      remote: "https://github.com/example/repo",
      aliases: ["demo"],
      classification: "confirmed",
      primaryGroupId: "project",
      memberOf: [],
      sourceId: null,
      metadata: {},
    }],
    policies: [{
      scope: { kind: "organization", id: "org" },
      settings: { "commands.test": "npm test" }, operations: [],
      constraints: [], instructions: [], knowledge: [], skills: [],
    }],
    workflows: [{
      id: "feature", scope: { kind: "project", id: "project" }, inputs: [], outputs: [],
      settings: {}, operations: [], constraints: [], steps: [],
    }],
    metadata: { marker },
  });
}

interface Fixture {
  root: string;
  configPath: string;
  planPath: string;
  configRevision: string;
  state: LocalStateDocument;
}

async function fixture(adapter: string): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-a17-"));
  const configPath = join(root, "config.json");
  const config = {
    schemaVersion: 2,
    documentType: "workspacectl/config",
    catalog: { adapter, path: join(root, "catalog.json") },
    localState: { adapter, path: join(root, "state.json") },
    plans: { directory: root },
    trustedRoots: [root],
  };
  await writeFile(configPath, JSON.stringify(config) + "\n", { mode: 0o600 });
  const configRevision = documentRevision(config);
  const state = emptyLocalStateDocument(configPath, configRevision);
  state.repositoryWorkspaces.push({
    id: "ws",
    kind: "primary",
    repositoryId: "repo",
    path: join(root, "checkout"),
    branch: "main",
    primarySelected: true,
    hostLinks: {},
  });
  return {
    root,
    configPath,
    planPath: join(root, "plan.json"),
    configRevision,
    state: validateLocalStateDocument(state),
  };
}

class IndependentAsyncStore<T> {
  #document: T | null = null;
  readonly #validate: (input: unknown) => T;
  readonly capabilities: DocumentRead<T>["capabilities"];
  freshness: DocumentRead<T>["freshness"];
  readCalls = 0;
  casCalls = 0;
  constructor(
    validate: (input: unknown) => T,
    options: { compareAndSwap?: "supported" | "read-only" | "unknown"; freshness?: DocumentRead<T>["freshness"] } = {},
  ) {
    this.#validate = validate;
    this.capabilities = { read: true, compareAndSwap: options.compareAndSwap ?? "supported" };
    this.freshness = options.freshness ?? "current";
  }
  async #later(): Promise<void> { await new Promise<void>((resolve) => setImmediate(resolve)); }
  async read(): Promise<DocumentRead<T>> {
    this.readCalls += 1;
    await this.#later();
    return {
      document: this.#document === null ? null : structuredClone(this.#document),
      revision: this.#document === null ? ABSENT_REVISION : documentRevision(this.#document),
      capabilities: structuredClone(this.capabilities),
      freshness: this.freshness,
    };
  }
  async compareAndSwap(expectedRevision: string, nextDocument: T): Promise<{ revision: string }> {
    this.casCalls += 1;
    await this.#later();
    if (this.capabilities.compareAndSwap !== "supported") {
      const error = new Error("read only") as Error & { code: string };
      error.code = "UNSUPPORTED";
      throw error;
    }
    const currentRevision = this.#document === null ? ABSENT_REVISION : documentRevision(this.#document);
    if (currentRevision !== expectedRevision) {
      const error = new Error("conflict") as Error & { code: string };
      error.code = "CONFLICT";
      throw error;
    }
    this.#document = this.#validate(nextDocument);
    return { revision: documentRevision(this.#document) };
  }
}

class FalsePostwriteReadbackStore extends IndependentAsyncStore<LocalStateDocument> {
  readonly #initial: LocalStateDocument;
  #afterCas = false;

  constructor(initial: LocalStateDocument) {
    super(validateLocalStateDocument);
    this.#initial = validateLocalStateDocument(initial);
  }

  async seed(): Promise<void> {
    await super.compareAndSwap(ABSENT_REVISION, this.#initial);
    this.casCalls = 0;
  }

  override async compareAndSwap(
    expectedRevision: string,
    nextDocument: LocalStateDocument,
  ): Promise<{ revision: string }> {
    const written = await super.compareAndSwap(expectedRevision, nextDocument);
    this.#afterCas = true;
    return written;
  }

  override async read(): Promise<DocumentRead<LocalStateDocument>> {
    const actual = await super.read();
    return this.#afterCas
      ? { ...actual, document: structuredClone(this.#initial) }
      : actual;
  }
}

function independentRegistry(
  catalogStore: CatalogStore = new IndependentAsyncStore(validateCatalogDocument),
  localStateStore: LocalStateStore = new IndependentAsyncStore(validateLocalStateDocument),
): StoreAdapterRegistry {
  const registry = new StoreAdapterRegistry();
  registry.registerCatalog("async-test", () => catalogStore);
  registry.registerLocalState("async-test", () => localStateStore);
  return registry;
}

async function seeded(kind: "file" | "memory" | "async-test") {
  const fx = await fixture(kind);
  let registry: StoreAdapterRegistry;
  if (kind === "file") registry = createBuiltinStoreRegistry();
  else if (kind === "memory") {
    registry = new StoreAdapterRegistry();
    const catalogStore = new MemoryCatalogStore();
    const stateStore = new MemoryLocalStateStore();
    registry.registerCatalog("memory", () => catalogStore);
    registry.registerLocalState("memory", () => stateStore);
  } else registry = independentRegistry();
  const loadedConfig = JSON.parse(await readFile(fx.configPath, "utf8"));
  const catalogStore = registry.createCatalog(kind, loadedConfig.catalog.path);
  const stateStore = registry.createLocalState(kind, loadedConfig.localState.path);
  await writeCatalogDocument(catalogStore, ABSENT_REVISION, catalog());
  await writeLocalStateDocument(stateStore, ABSENT_REVISION, fx.state);
  return { ...fx, registry, catalogStore, stateStore };
}

function editedWorkspaceState(
  initial: LocalStateDocument,
  marker: string,
): LocalStateDocument {
  const next = structuredClone(initial);
  next.workspacePolicyOverlays = [{
    scope: { kind: "workspace", id: "ws" },
    settings: { "commands.test": marker },
    operations: [],
    constraints: [],
    instructions: [],
    knowledge: [],
    skills: [],
  }];
  return validateLocalStateDocument(next);
}

async function writeWorkspaceDraft(
  setup: Awaited<ReturnType<typeof seeded>>,
  marker: string,
): Promise<{ draftPath: string; document: LocalStateDocument }> {
  const draft = await exportLocalStateDraft(setup.configPath, "ws", setup.registry);
  draft.document = editedWorkspaceState(draft.document, marker);
  const draftPath = join(setup.root, `workspace-${marker.replace(/[^a-z0-9]+/gi, "-")}.json`);
  await writeFile(draftPath, `${JSON.stringify(draft, null, 2)}\n`, { mode: 0o600 });
  return { draftPath, document: draft.document };
}

async function requireNoFallbackFiles(
  setup: Awaited<ReturnType<typeof seeded>>,
): Promise<void> {
  await assert.rejects(() => readFile(join(setup.root, "catalog.json")), { code: "ENOENT" });
  await assert.rejects(() => readFile(join(setup.root, "state.json")), { code: "ENOENT" });
}

function semanticResult(registry: Awaited<ReturnType<typeof readSelectedRegistry>>) {
  const context = resolveCatalogContext(registry.catalog, registry.localState, {
    repositoryId: "repo", workflowId: "feature",
  });
  return {
    groups: registry.catalog.groups,
    repositories: registry.catalog.repositories,
    settings: context.settings,
    workflow: context.workflow,
    provenance: context.provenance,
  };
}

test("A17 file, memory, and independent async adapters preserve public list/context/edit semantics", async () => {
  const results = [];
  const roots: string[] = [];
  try {
    for (const kind of ["file", "memory", "async-test"] as const) {
      const setup = await seeded(kind); roots.push(setup.root);
      const before = await readSelectedRegistry(setup.configPath, setup.registry);
      const listed = await listCatalog(setup.configPath, setup.registry);
      const plan = await createCatalogOperationPlan(
        setup.configPath,
        { type: "group-update", id: "project", name: "Renamed" },
        "2026-09-21T00:00:00.000Z",
        setup.registry,
      );
      const applied = await applyWorkspacePlan(plan, {
        selectedConfigPath: setup.configPath,
        approval: plan.id,
        storeRegistry: setup.registry,
      });
      results.push({
        before: semanticResult(before),
        list: { counts: listed.counts, repositories: listed.repositories },
        plan: {
          kind: plan.kind,
          actions: plan.actions.map(({ path: _path, ...action }) => action),
          outputs: plan.expectedOutputs,
        },
        after: semanticResult(await readSelectedRegistry(setup.configPath, setup.registry)),
        applied: { kind: applied.kind, catalog: applied.readback.catalog },
      });
    }
    assert.deepEqual(results[1], results[0]);
    assert.deepEqual(results[2], results[0]);
  } finally {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  }
});

test("A17 file, memory, and independent async adapters preserve workspace export, plan, CAS, and exact readback semantics", async () => {
  const results = [];
  const roots: string[] = [];
  try {
    for (const kind of ["file", "memory", "async-test"] as const) {
      const setup = await seeded(kind); roots.push(setup.root);
      const { draftPath, document } = await writeWorkspaceDraft(setup, "npm run a17");
      const plan = await createWorkspaceChangePlan(
        { configPath: setup.configPath, draftPath },
        "2026-09-24T00:00:00.000Z",
        setup.registry,
      );
      const applied = await applyWorkspacePlan(plan, {
        selectedConfigPath: setup.configPath,
        approval: plan.id,
        storeRegistry: setup.registry,
      });
      const selectedReadback = await setup.stateStore.read();
      assert.deepEqual(selectedReadback.document, document);
      assert.deepEqual(applied.readback.localState, selectedReadback.document);
      assert.equal(applied.revisions.localState, selectedReadback.revision);
      results.push({
        draft: { target: "workspace", workspaceId: "ws" },
        plan: {
          kind: plan.kind,
          actions: plan.actions.map(({
            path: _path,
            expectedRevision: _expected,
            nextRevision: _next,
            ...action
          }) => action),
          outputs: plan.expectedOutputs.map(({ revision: _revision, ...output }) => output),
        },
        setting: applied.readback.localState.workspacePolicyOverlays[0].settings["commands.test"],
      });
      if (kind !== "file") await requireNoFallbackFiles(setup);
    }
    assert.deepEqual(results[1], results[0]);
    assert.deepEqual(results[2], results[0]);
  } finally {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  }
});

test("A17 public local-state validation and primary-selection helpers keep the selected registry end to end", async () => {
  const setup = await seeded("async-test");
  try {
    const stateStore = setup.stateStore as IndependentAsyncStore<LocalStateDocument>;
    const { draftPath } = await writeWorkspaceDraft(setup, "validate-selected-registry");
    const validatedDraft = await validateConfigDraftFile(
      draftPath,
      setup.configPath,
      setup.registry,
    );
    assert.equal(validatedDraft.target, "workspace");

    const withSecondWorkspace = structuredClone((await stateStore.read()).document!);
    withSecondWorkspace.repositoryWorkspaces.push({
      id: "ws-2",
      kind: "primary",
      repositoryId: "repo",
      path: join(setup.root, "checkout-2"),
      branch: "task/a17",
      primarySelected: false,
      hostLinks: {},
    });
    await writeLocalStateDocument(
      stateStore,
      documentRevision(setup.state),
      validateLocalStateDocument(withSecondWorkspace),
    );
    const plan = await createPrimarySelectionPlan(
      { configPath: setup.configPath, repositoryId: "repo", workspaceId: "ws-2" },
      "2026-09-24T00:00:00.000Z",
      setup.registry,
    );
    const applied = await applyWorkspacePlan(plan, {
      selectedConfigPath: setup.configPath,
      approval: plan.id,
      storeRegistry: setup.registry,
    });
    assert.equal(
      applied.readback.localState.repositoryWorkspaces.find((workspace) => workspace.id === "ws-2")?.primarySelected,
      true,
    );
    assert.deepEqual(applied.readback.localState, (await stateStore.read()).document);
    await requireNoFallbackFiles(setup);
  } finally { await rm(setup.root, { recursive: true, force: true }); }
});

test("A17 current read-only local state remains exportable and validatable but cannot authorize a plan", async () => {
  const setup = await seeded("async-test");
  try {
    const stateStore = setup.stateStore as IndependentAsyncStore<LocalStateDocument>;
    const { draftPath } = await writeWorkspaceDraft(setup, "read-only-validation");
    stateStore.capabilities.compareAndSwap = "read-only";
    const exported = await exportLocalStateDraft(setup.configPath, "ws", setup.registry);
    assert.equal(exported.target, "workspace");
    const validated = await validateConfigDraftFile(
      draftPath,
      setup.configPath,
      setup.registry,
    );
    assert.equal(validated.target, "workspace");
    await assert.rejects(
      () => createWorkspaceChangePlan(
        { configPath: setup.configPath, draftPath },
        "2026-09-24T00:00:00.000Z",
        setup.registry,
      ),
      { code: "UNSUPPORTED" },
    );
    assert.equal(stateStore.casCalls, 1);
    await requireNoFallbackFiles(setup);
  } finally { await rm(setup.root, { recursive: true, force: true }); }
});

test("A17 workspace plan and apply reject degraded local-state authority without selected or file fallback mutation", async () => {
  for (const [capability, freshness, code] of [
    ["read-only", "current", "UNSUPPORTED"],
    ["unknown", "current", "UNTRUSTED_INPUT"],
    ["supported", "stale", "UNTRUSTED_INPUT"],
    ["supported", "partial", "UNTRUSTED_INPUT"],
    ["supported", "offline", "UNTRUSTED_INPUT"],
    ["supported", "unknown", "UNTRUSTED_INPUT"],
  ] as const) {
    const planSetup = await seeded("async-test");
    const applySetup = await seeded("async-test");
    try {
      const planStore = planSetup.stateStore as IndependentAsyncStore<LocalStateDocument>;
      const planDraft = await writeWorkspaceDraft(planSetup, `plan-${capability}-${freshness}`);
      const planBefore = (await planStore.read()).document;
      const planCasCalls = planStore.casCalls;
      planStore.capabilities.compareAndSwap = capability;
      planStore.freshness = freshness;
      await assert.rejects(
        () => createWorkspaceChangePlan(
          { configPath: planSetup.configPath, draftPath: planDraft.draftPath },
          "2026-09-24T00:00:00.000Z",
          planSetup.registry,
        ),
        { code },
      );
      assert.equal(planStore.casCalls, planCasCalls);
      assert.deepEqual((await planStore.read()).document, planBefore);
      await requireNoFallbackFiles(planSetup);

      const applyStore = applySetup.stateStore as IndependentAsyncStore<LocalStateDocument>;
      const applyDraft = await writeWorkspaceDraft(applySetup, `apply-${capability}-${freshness}`);
      const plan = await createWorkspaceChangePlan(
        { configPath: applySetup.configPath, draftPath: applyDraft.draftPath },
        "2026-09-24T00:00:00.000Z",
        applySetup.registry,
      );
      const applyBefore = (await applyStore.read()).document;
      const applyCasCalls = applyStore.casCalls;
      applyStore.capabilities.compareAndSwap = capability;
      applyStore.freshness = freshness;
      await assert.rejects(
        () => applyWorkspacePlan(plan, {
          selectedConfigPath: applySetup.configPath,
          approval: plan.id,
          storeRegistry: applySetup.registry,
        }),
        { code },
      );
      assert.equal(applyStore.casCalls, applyCasCalls);
      assert.deepEqual((await applyStore.read()).document, applyBefore);
      await requireNoFallbackFiles(applySetup);
    } finally {
      await Promise.all([planSetup.root, applySetup.root].map((root) =>
        rm(root, { recursive: true, force: true })));
    }
  }
});

test("A17 workspace plan and apply reject degraded catalog prerequisites before local-state CAS", async () => {
  for (const phase of ["plan", "apply"] as const) {
    const setup = await seeded("async-test");
    try {
      const catalogStore = setup.catalogStore as IndependentAsyncStore<CatalogDocument>;
      const stateStore = setup.stateStore as IndependentAsyncStore<LocalStateDocument>;
      const { draftPath } = await writeWorkspaceDraft(setup, `catalog-${phase}`);
      const plan = phase === "apply"
        ? await createWorkspaceChangePlan(
            { configPath: setup.configPath, draftPath },
            "2026-09-24T00:00:00.000Z",
            setup.registry,
          )
        : undefined;
      const casCalls = stateStore.casCalls;
      catalogStore.freshness = "stale";
      const action = phase === "plan"
        ? () => createWorkspaceChangePlan(
            { configPath: setup.configPath, draftPath },
            "2026-09-24T00:00:00.000Z",
            setup.registry,
          )
        : () => applyWorkspacePlan(plan!, {
            selectedConfigPath: setup.configPath,
            approval: plan!.id,
            storeRegistry: setup.registry,
          });
      await assert.rejects(action, { code: "UNTRUSTED_INPUT" });
      assert.equal(stateStore.casCalls, casCalls);
      await requireNoFallbackFiles(setup);
    } finally { await rm(setup.root, { recursive: true, force: true }); }
  }
});

test("A17 losing workspace CAS reports CONFLICT, preserves the winner, and never falls back", async () => {
  const setup = await seeded("async-test");
  try {
    const stateStore = setup.stateStore as IndependentAsyncStore<LocalStateDocument>;
    const { draftPath } = await writeWorkspaceDraft(setup, "loser");
    const plan = await createWorkspaceChangePlan(
      { configPath: setup.configPath, draftPath },
      "2026-09-24T00:00:00.000Z",
      setup.registry,
    );
    const winner = editedWorkspaceState(setup.state, "winner");
    await writeLocalStateDocument(stateStore, documentRevision(setup.state), winner);
    const winnerCasCalls = stateStore.casCalls;
    await assert.rejects(
      () => applyWorkspacePlan(plan, {
        selectedConfigPath: setup.configPath,
        approval: plan.id,
        storeRegistry: setup.registry,
      }),
      { code: "CONFLICT" },
    );
    assert.equal(stateStore.casCalls, winnerCasCalls);
    assert.deepEqual((await stateStore.read()).document, winner);
    await requireNoFallbackFiles(setup);
  } finally { await rm(setup.root, { recursive: true, force: true }); }
});

test("A17 workspace apply refuses false selected-adapter postwrite readback without fallback", async () => {
  const fx = await fixture("async-test");
  try {
    const catalogStore = new IndependentAsyncStore(validateCatalogDocument);
    await catalogStore.compareAndSwap(ABSENT_REVISION, catalog());
    const stateStore = new FalsePostwriteReadbackStore(fx.state);
    await stateStore.seed();
    const registry = independentRegistry(catalogStore, stateStore);
    const setup = { ...fx, registry, catalogStore, stateStore };
    const { draftPath } = await writeWorkspaceDraft(setup, "false-readback");
    const plan = await createWorkspaceChangePlan(
      { configPath: fx.configPath, draftPath },
      "2026-09-24T00:00:00.000Z",
      registry,
    );
    await assert.rejects(
      () => applyWorkspacePlan(plan, {
        selectedConfigPath: fx.configPath,
        approval: plan.id,
        storeRegistry: registry,
      }),
      { code: "ACTION_FAILED" },
    );
    assert.equal(stateStore.casCalls, 1);
    await requireNoFallbackFiles(setup);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test("A17 mutation previews fail closed for read-only, stale, partial, offline, and unknown authority", async () => {
  for (const [capability, freshness, code] of [
    ["read-only", "current", "UNSUPPORTED"],
    ["unknown", "current", "UNTRUSTED_INPUT"],
    ["supported", "stale", "UNTRUSTED_INPUT"],
    ["supported", "partial", "UNTRUSTED_INPUT"],
    ["supported", "offline", "UNTRUSTED_INPUT"],
    ["supported", "unknown", "UNTRUSTED_INPUT"],
  ] as const) {
    const fx = await fixture("async-test");
    try {
      const catalogStore = new IndependentAsyncStore(validateCatalogDocument);
      const stateStore = new IndependentAsyncStore(validateLocalStateDocument);
      const registry = independentRegistry(catalogStore, stateStore);
      await catalogStore.compareAndSwap(ABSENT_REVISION, catalog());
      await stateStore.compareAndSwap(ABSENT_REVISION, fx.state);
      catalogStore.capabilities.compareAndSwap = capability;
      catalogStore.freshness = freshness;
      await assert.rejects(
        () => createCatalogOperationPlan(
          fx.configPath,
          { type: "group-update", id: "project", name: "Refused" },
          "2026-09-21T00:00:00.000Z",
          registry,
        ),
        { code },
      );
      assert.equal((await catalogStore.read()).document!.groups[1].name, "Project");
    } finally { await rm(fx.root, { recursive: true, force: true }); }
  }
});

test("A17 approved applies recheck degraded authority and do not call CAS or mutate", async () => {
  for (const [capability, freshness, code] of [
    ["read-only", "current", "UNSUPPORTED"],
    ["unknown", "current", "UNTRUSTED_INPUT"],
    ["supported", "stale", "UNTRUSTED_INPUT"],
    ["supported", "partial", "UNTRUSTED_INPUT"],
    ["supported", "offline", "UNTRUSTED_INPUT"],
    ["supported", "unknown", "UNTRUSTED_INPUT"],
  ] as const) {
    const fx = await fixture("async-test");
    try {
      const catalogStore = new IndependentAsyncStore(validateCatalogDocument);
      const stateStore = new IndependentAsyncStore(validateLocalStateDocument);
      const registry = independentRegistry(catalogStore, stateStore);
      await catalogStore.compareAndSwap(ABSENT_REVISION, catalog());
      await stateStore.compareAndSwap(ABSENT_REVISION, fx.state);
      const plan = await createCatalogOperationPlan(
        fx.configPath,
        { type: "group-update", id: "project", name: "Refused" },
        "2026-09-21T00:00:00.000Z",
        registry,
      );
      catalogStore.capabilities.compareAndSwap = capability;
      catalogStore.freshness = freshness;
      await assert.rejects(
        () => applyWorkspacePlan(plan, {
          selectedConfigPath: fx.configPath,
          approval: plan.id,
          storeRegistry: registry,
        }),
        { code },
      );
      assert.equal((await catalogStore.read()).document!.groups[1].name, "Project");
    } finally { await rm(fx.root, { recursive: true, force: true }); }
  }
});

test("A17 configured selection trusts only installed names and rejects executable paths and fake authentication", async () => {
  for (const [adapter, extra, code] of [
    ["unknown-adapter", {}, "UNSUPPORTED"],
    ["./repository-adapter.mjs", {}, "INVALID_CONFIG"],
    ["file:///tmp/repository-adapter.mjs", {}, "INVALID_CONFIG"],
    ["node:fs", {}, "INVALID_CONFIG"],
    ["async-test", { authenticated: true }, "INVALID_CONFIG"],
  ] as const) {
    const fx = await fixture("file");
    try {
      const config = JSON.parse(await readFile(fx.configPath, "utf8"));
      config.catalog = { adapter, path: config.catalog.path, ...extra };
      await writeFile(fx.configPath, JSON.stringify(config) + "\n");
      await assert.rejects(() => readSelectedRegistry(fx.configPath, independentRegistry()), {
        code,
      });
    } finally { await rm(fx.root, { recursive: true, force: true }); }
  }
});

test("A17 a losing CAS apply reports CONFLICT and preserves the complete winner without fallback", async () => {
  const setup = await seeded("async-test");
  try {
    const plan = await createCatalogOperationPlan(
      setup.configPath,
      { type: "group-update", id: "project", name: "Loser" },
      "2026-09-21T00:00:00.000Z",
      setup.registry,
    );
    const winner = catalog("winner");
    winner.groups[1].name = "Winner";
    await writeCatalogDocument(setup.catalogStore, documentRevision(catalog()), winner);
    await assert.rejects(
      () => applyWorkspacePlan(plan, {
        selectedConfigPath: setup.configPath,
        approval: plan.id,
        storeRegistry: setup.registry,
      }),
      { code: "CONFLICT" },
    );
    assert.deepEqual((await setup.catalogStore.read()).document, winner);
    assert.equal((await setup.stateStore.read()).revision, documentRevision(setup.state));
  } finally { await rm(setup.root, { recursive: true, force: true }); }
});

test("A17 built-in registry exposes only file plus explicitly labelled local test adapters", () => {
  const registry = createBuiltinStoreRegistry();
  assert.ok(registry.createCatalog("file", "/tmp/a17-file.json") instanceof FileCatalogStore);
  assert.ok(registry.createLocalState("file", "/tmp/a17-state.json") instanceof FileLocalStateStore);
  assert.equal(registry.createCatalog("test-async-file", "/tmp/a17-test.json").constructor.name, "AsyncTestCatalogStore");
  assert.throws(() => registry.createCatalog("memory", "/tmp/no-global-memory"), { code: "UNSUPPORTED" });
  assert.throws(() => registry.createCatalog("https", "https://example.invalid"), { code: "UNSUPPORTED" });
});

test("A17 public CLI selects the installed named async test adapter for list, context, preview, apply, and readback", async () => {
  const fx = await fixture("test-async-file");
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args, "--json"], { encoding: "utf8" });
  try {
    const config = JSON.parse(await readFile(fx.configPath, "utf8"));
    await writeCatalogDocument(new FileCatalogStore(config.catalog.path), ABSENT_REVISION, catalog());
    await writeLocalStateDocument(new FileLocalStateStore(config.localState.path), ABSENT_REVISION, fx.state);

    let outcome = run(["list", "--config", fx.configPath]);
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.equal(JSON.parse(outcome.stdout).counts.total, 1);
    outcome = run(["context", "repo", "--workflow", "feature", "--config", fx.configPath]);
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.equal(JSON.parse(outcome.stdout).context.settings["commands.test"], "npm test");
    outcome = run(["group", "update", "--id", "project", "--name", "CLI Renamed", "--config", fx.configPath, "--plan", fx.planPath]);
    assert.equal(outcome.status, 0, outcome.stderr);
    const preview = JSON.parse(outcome.stdout);
    assert.equal(preview.applied, false);
    outcome = run(["apply", "--config", fx.configPath, "--plan", fx.planPath, "--approve", preview.plan.id]);
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.equal(JSON.parse(outcome.stdout).readback.catalog.groups[1].name, "CLI Renamed");

    outcome = run(["config", "export", "--target", "workspace", "--workspace", "ws", "--config", fx.configPath]);
    assert.equal(outcome.status, 0, outcome.stderr);
    const workspaceDraft = JSON.parse(outcome.stdout).draft;
    workspaceDraft.document = editedWorkspaceState(workspaceDraft.document, "npm run cli-a17");
    const draftPath = join(fx.root, "workspace-draft.json");
    const workspacePlanPath = join(fx.root, "workspace-plan.json");
    await writeFile(draftPath, `${JSON.stringify(workspaceDraft, null, 2)}\n`, { mode: 0o600 });
    outcome = run(["config", "plan", draftPath, "--config", fx.configPath, "--plan", workspacePlanPath]);
    assert.equal(outcome.status, 0, outcome.stderr);
    const workspacePreview = JSON.parse(outcome.stdout);
    assert.equal(workspacePreview.plan.kind, "workspace-edit");
    outcome = run(["apply", "--config", fx.configPath, "--plan", workspacePlanPath, "--approve", workspacePreview.plan.id]);
    assert.equal(outcome.status, 0, outcome.stderr);
    const workspaceApply = JSON.parse(outcome.stdout);
    outcome = run(["config", "export", "--target", "workspace", "--workspace", "ws", "--config", fx.configPath]);
    assert.equal(outcome.status, 0, outcome.stderr);
    const workspaceReadback = JSON.parse(outcome.stdout).draft;
    assert.deepEqual(workspaceApply.readback.localState, workspaceReadback.document);
    assert.deepEqual(workspaceReadback.document, JSON.parse(await readFile(config.localState.path, "utf8")));
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});
