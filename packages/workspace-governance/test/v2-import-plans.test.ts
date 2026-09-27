import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyWorkspacePlan,
  createImportPlan,
  createInitPlan,
  saveWorkspacePlan,
  type ImportRequest,
  type InitRequest,
} from "../src/registry-plans.ts";
import { FileCatalogStore, FileLocalStateStore } from "../src/document-stores.ts";
import { canonicalJson } from "../src/core.ts";
import { emptyCatalogDocument } from "../src/v2-model.ts";

const manifest = () => ({
  apiVersion: "workspace-governance/v1",
  authorityId: "synthetic-import",
  metadata: { activationAuthorized: true },
  nodes: [
    {
      id: "legacy-user",
      kind: "user",
      slug: "legacy",
      parentId: null,
      visibility: { mode: "public", readers: [] },
    },
    {
      id: "org-acme",
      kind: "domain",
      label: "Acme",
      slug: "acme",
      parentId: "legacy-user",
    },
    {
      id: "namespace-acme",
      kind: "namespace",
      slug: "acme",
      parentId: "org-acme",
    },
    {
      id: "repo-acme-service",
      kind: "repository",
      label: "Service",
      slug: "service",
      parentId: "namespace-acme",
      remote: "https://github.com/acme/service",
    },
  ],
  policies: [],
  workflows: [],
});

const sidecar = () => ({
  apiVersion: "workspace-governance/unclassified-repositories-v1",
  count: 1,
  catalogActivationAuthorized: true,
  repositories: [
    {
      repository: "acme/unplaced",
      status: "unclassified",
      reason: "No reviewed placement.",
    },
  ],
});

interface Fixture {
  root: string;
  init: InitRequest;
  imported: ImportRequest;
  importPlanPath: string;
  manifestBytes: Buffer;
  sidecarBytes: Buffer;
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-v2-import-plan-"));
  const directories = Object.fromEntries(
    ["config", "data", "state", "plans", "workspaces", "sources"].map((name) => [
      name,
      join(root, name),
    ]),
  );
  await Promise.all(Object.values(directories).map((path) => mkdir(path, { mode: 0o700 })));
  const init: InitRequest = {
    configPath: join(directories.config, "config.yaml"),
    catalogPath: join(directories.data, "catalog.json"),
    localStatePath: join(directories.state, "local-state.json"),
    plansDirectory: directories.plans,
    trustedRoots: [directories.workspaces],
  };
  const initPlan = await createInitPlan(init, "2026-09-14T00:00:00.000Z");
  await applyWorkspacePlan(initPlan, {
    selectedConfigPath: init.configPath,
    approval: initPlan.id,
  });

  const manifestPath = join(directories.sources, "manifest.json");
  const unclassifiedPath = join(directories.sources, "unclassified.json");
  const manifestBytes = Buffer.from(JSON.stringify(manifest(), null, 2) + "\n");
  const sidecarBytes = Buffer.from(JSON.stringify(sidecar(), null, 2) + "\n");
  await writeFile(manifestPath, manifestBytes, { mode: 0o600 });
  await writeFile(unclassifiedPath, sidecarBytes, { mode: 0o600 });
  return {
    root,
    init,
    imported: { configPath: init.configPath, manifestPath, unclassifiedPath },
    importPlanPath: join(directories.plans, "import.json"),
    manifestBytes,
    sidecarBytes,
  };
}

const rawSha256 = (value: Buffer): string =>
  createHash("sha256").update(value).digest("hex");

async function isAbsent(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

test("M2 import preview pins current stores and source bytes without activating the catalog", async () => {
  const input = await fixture();
  try {
    const catalogBefore = await new FileCatalogStore(input.init.catalogPath).read();
    const localStateBefore = await new FileLocalStateStore(input.init.localStatePath).read();
    const plan = await createImportPlan(input.imported, "2026-09-14T00:01:00.000Z");

    assert.equal(plan.kind, "import-v1");
    assert.equal(plan.inputRevisions.catalog, catalogBefore.revision);
    assert.equal(plan.inputRevisions.localState, localStateBefore.revision);
    assert.match(plan.inputRevisions.config, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(plan.inputRevisions.sources, {
      manifest: rawSha256(input.manifestBytes),
      unclassified: rawSha256(input.sidecarBytes),
    });
    assert.equal(plan.actions.length, 1);
    assert.deepEqual(plan.actions[0], {
      id: "write-imported-catalog",
      type: "document-cas",
      target: "catalog",
      path: input.init.catalogPath,
      expectedRevision: catalogBefore.revision,
      nextRevision: plan.expectedOutputs[0].revision,
    });
    assert.equal(plan.repositoryIds.length, 2);
    assert.equal(plan.repositoryIds[0], "repo-acme-service");
    assert.match(plan.repositoryIds[1], /^repo-unclassified-[a-f0-9]{24}$/);

    await saveWorkspacePlan(input.importPlanPath, plan);
    assert.equal((await stat(input.importPlanPath)).mode & 0o777, 0o600);
    const catalogAfter = await new FileCatalogStore(input.init.catalogPath).read();
    assert.equal(catalogAfter.revision, catalogBefore.revision);
    assert.equal(canonicalJson(catalogAfter.document), canonicalJson(emptyCatalogDocument()));
    assert.equal((await new FileLocalStateStore(input.init.localStatePath).read()).revision, localStateBefore.revision);
    assert.deepEqual(await readFile(input.imported.manifestPath), input.manifestBytes);
    assert.deepEqual(await readFile(input.imported.unclassifiedPath), input.sidecarBytes);
    assert.equal(await isAbsent(`${input.init.catalogPath}.lock`), true);
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

test("M2 exact import approval re-derives, CAS-writes, and reads back only the catalog", async () => {
  const input = await fixture();
  try {
    const plan = await createImportPlan(input.imported, "2026-09-14T00:01:00.000Z");
    await saveWorkspacePlan(input.importPlanPath, plan);
    const before = await new FileCatalogStore(input.init.catalogPath).read();

    await assert.rejects(
      () => applyWorkspacePlan(plan, { selectedConfigPath: input.init.configPath }),
      { code: "APPROVAL_REQUIRED" },
    );
    assert.equal((await new FileCatalogStore(input.init.catalogPath).read()).revision, before.revision);

    const result = await applyWorkspacePlan(plan, {
      selectedConfigPath: input.init.configPath,
      approval: plan.id,
    });
    assert.equal(result.kind, "import-v1");
    assert.equal(result.planId, plan.id);
    assert.equal(result.revisions.catalog, plan.expectedOutputs[0].revision);
    assert.equal(result.revisions.config, plan.inputRevisions.config);
    assert.equal(result.revisions.localState, plan.inputRevisions.localState);
    assert.equal(result.readback.catalog.groups.length, 1);
    assert.equal(result.readback.catalog.repositories.length, 2);
    assert.deepEqual(
      result.readback.catalog.repositories.map(({ id, classification, primaryGroupId }) => ({
        id,
        classification,
        primaryGroupId,
      })),
      [
        {
          id: "repo-acme-service",
          classification: "confirmed",
          primaryGroupId: "org-acme",
        },
        {
          id: plan.repositoryIds[1],
          classification: "unclassified",
          primaryGroupId: null,
        },
      ],
    );
    assert.deepEqual(result.readback.localState.repositoryWorkspaces, []);
    assert.deepEqual(await readFile(input.imported.manifestPath), input.manifestBytes);
    assert.deepEqual(await readFile(input.imported.unclassifiedPath), input.sidecarBytes);
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

test("M2 import apply rejects changed source bytes as stale and preserves the empty catalog", async () => {
  const input = await fixture();
  try {
    const plan = await createImportPlan(input.imported, "2026-09-14T00:01:00.000Z");
    const changed = sidecar();
    changed.repositories[0].reason = "Changed after preview.";
    await writeFile(
      input.imported.unclassifiedPath,
      JSON.stringify(changed, null, 2) + "\n",
      { mode: 0o600 },
    );
    const before = await new FileCatalogStore(input.init.catalogPath).read();
    await assert.rejects(
      () => applyWorkspacePlan(plan, {
        selectedConfigPath: input.init.configPath,
        approval: plan.id,
      }),
      { code: "STALE_PLAN" },
    );
    const after = await new FileCatalogStore(input.init.catalogPath).read();
    assert.equal(after.revision, before.revision);
    assert.equal(canonicalJson(after.document), canonicalJson(emptyCatalogDocument()));
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

test("M2 import apply preserves an existing catalog lock and refuses busy", async () => {
  const input = await fixture();
  try {
    const plan = await createImportPlan(input.imported, "2026-09-14T00:01:00.000Z");
    const lockPath = `${input.init.catalogPath}.lock`;
    const lockBytes = Buffer.from("synthetic-other-writer\n");
    await writeFile(lockPath, lockBytes, { mode: 0o600 });
    const before = await new FileCatalogStore(input.init.catalogPath).read();
    await assert.rejects(
      () => applyWorkspacePlan(plan, {
        selectedConfigPath: input.init.configPath,
        approval: plan.id,
      }),
      { code: "BUSY" },
    );
    assert.deepEqual(await readFile(lockPath), lockBytes);
    assert.equal((await new FileCatalogStore(input.init.catalogPath).read()).revision, before.revision);
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});
