import test from "node:test";
import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyWorkspacePlan,
  createInitPlan,
  loadWorkspacesConfig,
  saveWorkspacePlan,
  type InitRequest,
} from "../src/registry-plans.ts";
import {
  FileCatalogStore,
  FileLocalStateStore,
  writeCatalogDocument,
} from "../src/document-stores.ts";
import {
  ABSENT_REVISION,
  documentRevision,
  emptyCatalogDocument,
} from "../src/v2-model.ts";

async function setup(): Promise<{ root: string; request: InitRequest; planPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-v2-init-"));
  const configDirectory = join(root, "config");
  const dataDirectory = join(root, "data");
  const stateDirectory = join(root, "state");
  const plansDirectory = join(root, "plans");
  const trustedRoot = join(root, "workspaces");
  await Promise.all(
    [configDirectory, dataDirectory, stateDirectory, plansDirectory, trustedRoot].map((path) =>
      mkdir(path, { mode: 0o700 }),
    ),
  );
  const request: InitRequest = {
    configPath: join(configDirectory, "config.yaml"),
    catalogPath: join(dataDirectory, "catalog.json"),
    localStatePath: join(stateDirectory, "local-state.json"),
    plansDirectory,
    trustedRoots: [trustedRoot],
  };
  return { root, request, planPath: join(plansDirectory, "init-plan.json") };
}

async function absent(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

test("M2 init preview saves only a private inert plan from an unconfigured target", async () => {
  const { root, request, planPath } = await setup();
  try {
    const plan = await createInitPlan(request, "2026-09-14T00:00:00.000Z");
    assert.equal(plan.kind, "init");
    assert.match(plan.id, /^plan-[a-f0-9]{32}$/);
    assert.equal(plan.inputRevisions.config, ABSENT_REVISION);
    assert.equal(plan.inputRevisions.catalog, ABSENT_REVISION);
    assert.equal(plan.inputRevisions.localState, ABSENT_REVISION);
    assert.deepEqual(plan.repositoryIds, []);
    assert.deepEqual(plan.approvalsRequired, [
      { id: "apply", kind: "explicit-plan-id" },
    ]);
    await saveWorkspacePlan(planPath, plan);
    assert.equal((await stat(planPath)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(planPath, "utf8")).id, plan.id);
    for (const path of [request.configPath, request.catalogPath, request.localStatePath])
      assert.equal(await absent(path), true, path);

    await assert.rejects(
      () => applyWorkspacePlan(plan, { selectedConfigPath: request.configPath }),
      { code: "APPROVAL_REQUIRED" },
    );
    for (const path of [request.configPath, request.catalogPath, request.localStatePath])
      assert.equal(await absent(path), true, path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M2 exact init approval re-derives, CAS-writes, and reads back all three documents", async () => {
  const { root, request, planPath } = await setup();
  try {
    const plan = await createInitPlan(request, "2026-09-14T00:00:00.000Z");
    await saveWorkspacePlan(planPath, plan);
    const result = await applyWorkspacePlan(plan, {
      selectedConfigPath: request.configPath,
      approval: plan.id,
    });
    assert.equal(result.planId, plan.id);
    assert.equal(result.kind, "init");
    assert.equal(result.revisions.config, plan.expectedOutputs.find((item) => item.target === "config")?.revision);
    assert.equal(result.revisions.catalog, plan.expectedOutputs.find((item) => item.target === "catalog")?.revision);
    assert.equal(result.revisions.localState, plan.expectedOutputs.find((item) => item.target === "local-state")?.revision);

    const loaded = await loadWorkspacesConfig(request.configPath);
    assert.equal(loaded.revision, result.revisions.config);
    assert.deepEqual(loaded.document.trustedRoots, request.trustedRoots);
    assert.equal((await new FileCatalogStore(request.catalogPath).read()).revision, result.revisions.catalog);
    const state = await new FileLocalStateStore(request.localStatePath).read();
    assert.equal(state.revision, result.revisions.localState);
    assert.equal(state.document?.selectedConfig.path, request.configPath);
    assert.equal(state.document?.selectedConfig.revision, result.revisions.config);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M2 tampered plan and changed init input refuse before changing remaining targets", async () => {
  const first = await setup();
  try {
    const plan = await createInitPlan(first.request, "2026-09-14T00:00:00.000Z");
    const tampered = structuredClone(plan);
    tampered.request.catalogPath = join(first.root, "other-catalog.json");
    await assert.rejects(
      () => applyWorkspacePlan(tampered, {
        selectedConfigPath: first.request.configPath,
        approval: tampered.id,
      }),
      { code: "STALE_PLAN" },
    );
    assert.equal(await absent(first.request.configPath), true);
    assert.equal(await absent(first.request.catalogPath), true);
    assert.equal(await absent(first.request.localStatePath), true);
  } finally {
    await rm(first.root, { recursive: true, force: true });
  }

  const second = await setup();
  try {
    const plan = await createInitPlan(second.request, "2026-09-14T00:00:00.000Z");
    await writeCatalogDocument(
      new FileCatalogStore(second.request.catalogPath),
      ABSENT_REVISION,
      emptyCatalogDocument(),
    );
    const catalogBefore = await readFile(second.request.catalogPath);
    await assert.rejects(
      () => applyWorkspacePlan(plan, {
        selectedConfigPath: second.request.configPath,
        approval: plan.id,
      }),
      { code: "STALE_PLAN" },
    );
    assert.deepEqual(await readFile(second.request.catalogPath), catalogBefore);
    assert.equal(await absent(second.request.configPath), true);
    assert.equal(await absent(second.request.localStatePath), true);
  } finally {
    await rm(second.root, { recursive: true, force: true });
  }
});

test("M2 init apply refuses a destination ancestor redirected after preview before any document write", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-v2-init-path-"));
  try {
    const selected = join(root, "selected");
    const preserved = join(root, "selected-at-preview");
    const redirected = join(root, "redirected");
    const plansDirectory = join(root, "plans");
    const trustedRoot = join(root, "workspaces");
    for (const path of [
      join(selected, "storage"),
      join(redirected, "storage"),
      plansDirectory,
      trustedRoot,
    ]) await mkdir(path, { recursive: true, mode: 0o700 });
    const request: InitRequest = {
      configPath: join(selected, "storage", "config.yaml"),
      catalogPath: join(selected, "storage", "catalog.json"),
      localStatePath: join(selected, "storage", "local-state.json"),
      plansDirectory,
      trustedRoots: [trustedRoot],
    };
    const plan = await createInitPlan(request, "2026-09-14T00:00:00.000Z");
    await rename(selected, preserved);
    await symlink(redirected, selected, "dir");

    await assert.rejects(
      () => applyWorkspacePlan(plan, {
        selectedConfigPath: request.configPath,
        approval: plan.id,
      }),
      { code: "STALE_PLAN" },
    );
    assert.deepEqual(await readdir(join(preserved, "storage")), []);
    assert.deepEqual(await readdir(join(redirected, "storage")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M2 init refuses an existing selected config rather than silently activating it", async () => {
  const { root, request } = await setup();
  try {
    await writeFile(request.configPath, "schemaVersion: 1\n", { mode: 0o600 });
    await assert.rejects(
      () => createInitPlan(request, "2026-09-14T00:00:00.000Z"),
      { code: "CONFLICT" },
    );
    assert.equal(documentRevision(emptyCatalogDocument()).startsWith("sha256:"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
