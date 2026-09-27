import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { documentRevision, validateCatalogDocument } from "../src/v2-model.ts";
import {
  assertWorkspacePlanIntegrity,
  applyWorkspacePlan,
  createCatalogChangePlan,
  createCatalogOperationPlan,
} from "../src/registry-plans.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const tempRoot = join(process.env.TMPDIR ?? tmpdir(), "workspacectl-a05-cycle1");
const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

async function initializedFixture() {
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(tempRoot, "fixture-"));
  const directories = Object.fromEntries(
    ["config", "data", "state", "plans", "workspaces", "drafts"].map((name) => [name, join(root, name)]),
  );
  await Promise.all(Object.values(directories).map((path) => mkdir(path, { mode: 0o700 })));
  const config = join(directories.config, "config.yaml");
  const catalog = join(directories.data, "catalog.json");
  const state = join(directories.state, "local-state.json");
  const initPlan = join(directories.plans, "init.json");
  let result = run([
    "init", "--config", config, "--catalog", catalog, "--state", state,
    "--plans-dir", directories.plans, "--trusted-root", directories.workspaces,
    "--plan", initPlan, "--json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const planId = JSON.parse(result.stdout).plan.id;
  result = run(["apply", "--config", config, "--plan", initPlan, "--approve", planId, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  return { root, directories, config, catalog, state };
}

const group = (
  id: string,
  kind: "organization" | "area" | "project",
  parentId: string | null,
) => ({ id, kind, name: id, slug: id, parentId, metadata: {} });

function catalogWithMembership(primaryGroupId: string | null, memberOf: string[]) {
  return {
    schemaVersion: 2 as const,
    documentType: "workspacectl/catalog" as const,
    groups: [
      group("org-a", "organization", null),
      group("area-a", "area", "org-a"),
      group("project-a", "project", "area-a"),
      group("org-b", "organization", null),
      group("project-b", "project", "org-b"),
    ],
    repositories: [{
      id: "repo-one",
      remote: "https://github.com/Owner/repo-one",
      sourceId: null,
      primaryGroupId,
      memberOf,
      aliases: [],
      classification: primaryGroupId === null ? "unclassified" as const : "confirmed" as const,
      metadata: {},
    }],
    sources: [],
    policies: [],
    workflows: [],
    metadata: {},
  };
}

async function seedCatalog(
  fixture: Awaited<ReturnType<typeof initializedFixture>>,
  document: ReturnType<typeof catalogWithMembership>,
) {
  const draft = JSON.parse(run(["config", "export", "--target", "catalog", "--config", fixture.config]).stdout);
  draft.document = document;
  const draftPath = join(fixture.directories.drafts, "seed.json");
  const planPath = join(fixture.directories.plans, "seed.json");
  await writeFile(draftPath, JSON.stringify(draft, null, 2) + "\n");
  let result = run(["config", "plan", draftPath, "--config", fixture.config, "--plan", planPath, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const planId = JSON.parse(result.stdout).plan.id;
  result = run(["apply", "--config", fixture.config, "--plan", planPath, "--approve", planId, "--json"]);
  assert.equal(result.status, 0, result.stderr);
}

test("A05 cycle 1 rejects duplicate-primary and cross-organization additional memberships", () => {
  assert.throws(() => validateCatalogDocument(catalogWithMembership("project-a", ["project-a"])));
  assert.throws(() => validateCatalogDocument(catalogWithMembership("project-a", ["project-b"])));
  assert.doesNotThrow(() => validateCatalogDocument(catalogWithMembership(null, ["project-b"])));
});

test("A05 cycle 2 rejects flags not owned by each public group and repo subcommand", async () => {
  const fixture = await initializedFixture();
  try {
    const plan = join(fixture.directories.plans, "irrelevant.json");
    const cases = [
      ["group", "show", "--id", "missing", "--kind", "project"],
      ["group", "show", "--id", "missing", "--plan", plan],
      ["group", "list", "--plan", plan],
      ["group", "create", "--kind", "organization", "--id", "org-new", "--name", "New", "--slug", "new", "--action", "add", "--plan", plan],
      ["group", "update", "--id", "missing", "--name", "New", "--kind", "project", "--plan", plan],
      ["group", "update", "--id", "missing", "--slug", "new", "--parent", "org-new", "--plan", plan],
      ["group", "reparent", "--id", "missing", "--parent", "org-new", "--name", "New", "--plan", plan],
      ["group", "reparent", "--id", "missing", "--parent", "org-new", "--slug", "new", "--plan", plan],
      ["repo", "list", "--plan", plan],
      ["repo", "show", "--id", "missing", "--action", "add"],
      ["repo", "show", "--id", "missing", "--plan", plan],
      ["repo", "membership", "--id", "missing", "--project", "missing", "--action", "add", "--decision", "accept", "--plan", plan],
      ["repo", "membership", "--id", "missing", "--project", "missing", "--action", "add", "--group", "missing", "--plan", plan],
      ["repo", "classify", "--id", "missing", "--decision", "accept", "--group", "missing", "--project", "missing", "--plan", plan],
      ["repo", "classify", "--id", "missing", "--decision", "reject", "--action", "remove", "--plan", plan],
    ];
    for (const args of cases) {
      const result = run([...args, "--config", fixture.config, "--json"]);
      assert.notEqual(result.status, 0, args.join(" "));
      assert.equal(JSON.parse(result.stderr).error.code, "INVALID_CONFIG", args.join(" "));
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A05 cycle 1 validates every operation variant exactly and rejects only suggestions", async () => {
  const fixture = await initializedFixture();
  try {
    await seedCatalog(fixture, catalogWithMembership("project-a", []));
    const malformed = [
      { type: "unknown", id: "repo-one" },
      { type: "repo-membership", id: "repo-one", projectId: "project-a", action: "delete" },
      { type: "repo-classify", id: "repo-one", decision: "maybe" },
      { type: "group-update", id: "project-a", name: "Renamed", extra: true },
      { type: "group-create", group: { id: "new", kind: "project", name: "New", slug: "new", parentId: "org-a", metadata: {}, extra: true } },
    ];
    for (const operation of malformed) {
      await assert.rejects(
        createCatalogOperationPlan(fixture.config, operation as never, "2026-09-20T00:00:00.000Z"),
        (error: any) => error?.code === "INVALID_CONFIG",
      );
    }
    await assert.rejects(
      createCatalogOperationPlan(
        fixture.config,
        { type: "repo-classify", id: "repo-one", decision: "reject" },
        "2026-09-20T00:00:00.000Z",
      ),
      (error: any) => error?.code === "INVALID_CONFIG",
    );
    assert.equal(
      JSON.parse(await readFile(fixture.catalog, "utf8")).repositories[0].classification,
      "confirmed",
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A05 cycle 1 plans expose one digest-covered exact changed-record preview and schema union", async () => {
  const fixture = await initializedFixture();
  try {
    await seedCatalog(fixture, catalogWithMembership("project-a", []));
    const plan = await createCatalogOperationPlan(
      fixture.config,
      { type: "group-update", id: "project-a", name: "Renamed" },
      "2026-09-20T00:00:00.000Z",
    );
    const change = plan.request.catalogChange as any;
    assert.deepEqual(Object.keys(change), ["currentRevision", "nextRevision", "changedRecords"]);
    assert.equal(change.currentRevision, plan.inputRevisions.catalog);
    assert.equal(change.nextRevision, plan.actions[0].nextRevision);
    assert.equal(change.nextRevision, plan.expectedOutputs[0].revision);
    assert.deepEqual(change.changedRecords, [{
      section: "groups",
      id: "project-a",
      before: group("project-a", "project", "area-a"),
      after: { ...group("project-a", "project", "area-a"), name: "Renamed" },
    }]);
    const tampered = structuredClone(plan);
    (tampered.request.catalogChange as any).changedRecords[0].after.name = "Other";
    assert.throws(() => assertWorkspacePlanIntegrity(tampered));

    const exported = JSON.parse(run(["config", "export", "--target", "catalog", "--config", fixture.config]).stdout);
    exported.document.groups.find((candidate: any) => candidate.id === "project-a").name = "Draft Renamed";
    const draftPath = join(fixture.directories.drafts, "preview.json");
    await writeFile(draftPath, JSON.stringify(exported, null, 2) + "\n");
    const draftPlan = await createCatalogChangePlan(
      { configPath: fixture.config, draftPath },
      "2026-09-20T00:00:00.000Z",
    );
    assert.deepEqual(Object.keys(draftPlan.request.catalogChange as object), Object.keys(change));
    assert.equal((draftPlan.request.catalogChange as any).changedRecords[0].id, "project-a");

    const schemaPath = fileURLToPath(new URL("../schemas/v2/workspace-plan.schema.json", import.meta.url));
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));
    const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);
    assert.equal(validate(plan), true, JSON.stringify(validate.errors));
    const malformed = structuredClone(plan);
    (malformed.request.operation as any).action = "delete";
    assert.equal(validate(malformed), false, "schema accepted malformed catalog operation");
    const unknownRequest = structuredClone(plan);
    (unknownRequest.request as any).extra = true;
    assert.equal(validate(unknownRequest), false, "schema accepted unknown catalog request key");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A05 cycle 1 final snapshots refuse draft bytes and redirected catalog targets after approval", async () => {
  const fixture = await initializedFixture();
  const checkout = join(fixture.directories.workspaces, "checkout.fact");
  try {
    await writeFile(checkout, "retained synthetic checkout bytes\n");
    const stateDocument = JSON.parse(await readFile(fixture.state, "utf8"));
    stateDocument.metadata.syntheticCheckoutPath = checkout;
    await writeFile(fixture.state, JSON.stringify(stateDocument, null, 2) + "\n");

    const exported = JSON.parse(run(["config", "export", "--target", "catalog", "--config", fixture.config]).stdout);
    exported.document.groups.push(group("org-approved", "organization", null));
    const draftPath = join(fixture.directories.drafts, "race.json");
    const approvedDraftBytes = JSON.stringify(exported, null, 2) + "\n";
    await writeFile(draftPath, approvedDraftBytes);
    const draftPlan = await createCatalogChangePlan(
      { configPath: fixture.config, draftPath },
      "2026-09-20T00:00:00.000Z",
    );
    const beforeDraftRace = {
      config: await readFile(fixture.config),
      catalog: await readFile(fixture.catalog),
      state: await readFile(fixture.state),
      checkout: await readFile(checkout),
    };
    await assert.rejects(
      applyWorkspacePlan(draftPlan, {
        selectedConfigPath: fixture.config,
        approval: draftPlan.id,
        testHooks: {
          beforeCatalogFinalSnapshot: async () => {
            const changed = structuredClone(exported);
            changed.document.groups[0].name = "Unapproved bytes";
            await writeFile(draftPath, JSON.stringify(changed, null, 2) + "\n");
          },
        },
      } as any),
      (error: any) => error?.code === "STALE_PLAN",
    );
    assert.deepEqual(await readFile(fixture.config), beforeDraftRace.config);
    assert.deepEqual(await readFile(fixture.catalog), beforeDraftRace.catalog);
    assert.deepEqual(await readFile(fixture.state), beforeDraftRace.state);
    assert.deepEqual(await readFile(checkout), beforeDraftRace.checkout);

    await writeFile(draftPath, approvedDraftBytes);
    const redirectPlan = await createCatalogChangePlan(
      { configPath: fixture.config, draftPath },
      "2026-09-20T00:00:01.000Z",
    );
    const alternateCatalog = join(fixture.directories.data, "alternate-catalog.json");
    const alternateState = join(fixture.directories.state, "alternate-state.json");
    await writeFile(alternateCatalog, beforeDraftRace.catalog);
    const redirectedConfig = JSON.parse(beforeDraftRace.config.toString("utf8"));
    redirectedConfig.catalog.path = alternateCatalog;
    redirectedConfig.localState.path = alternateState;
    const redirectedState = structuredClone(stateDocument);
    redirectedState.selectedConfig.revision = documentRevision(redirectedConfig);
    await writeFile(alternateState, JSON.stringify(redirectedState, null, 2) + "\n");
    const redirectedConfigBytes = Buffer.from(JSON.stringify(redirectedConfig, null, 2) + "\n");
    const alternateCatalogBefore = await readFile(alternateCatalog);
    await assert.rejects(
      applyWorkspacePlan(redirectPlan, {
        selectedConfigPath: fixture.config,
        approval: redirectPlan.id,
        testHooks: {
          beforeCatalogFinalSnapshot: async () => {
            await writeFile(fixture.config, JSON.stringify(redirectedConfig, null, 2) + "\n");
          },
        },
      } as any),
      (error: any) => error?.code === "STALE_PLAN",
    );
    assert.deepEqual(await readFile(fixture.config), redirectedConfigBytes);
    assert.deepEqual(await readFile(fixture.catalog), beforeDraftRace.catalog);
    assert.deepEqual(await readFile(alternateCatalog), alternateCatalogBefore);
    assert.deepEqual(await readFile(fixture.state), beforeDraftRace.state);
    assert.deepEqual(await readFile(checkout), beforeDraftRace.checkout);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A05 cycle 1 returns genuine post-write readback bound to the approved catalog revision", async () => {
  const fixture = await initializedFixture();
  try {
    const plan = await createCatalogOperationPlan(
      fixture.config,
      { type: "group-create", group: group("org-readback", "organization", null) },
      "2026-09-20T00:00:00.000Z",
    );
    const applied = await applyWorkspacePlan(plan, {
      selectedConfigPath: fixture.config,
      approval: plan.id,
      testHooks: {
        afterCatalogWriteBeforeReadback: async () => {
          const state = JSON.parse(await readFile(fixture.state, "utf8"));
          state.metadata.postWriteMarker = "observed";
          await writeFile(fixture.state, JSON.stringify(state, null, 2) + "\n");
        },
      },
    } as any);
    assert.equal(applied.readback.localState.metadata.postWriteMarker, "observed");
    assert.equal(applied.revisions.catalog, plan.actions[0].nextRevision);
    assert.equal(applied.revisions.catalog, plan.expectedOutputs[0].revision);
    assert.equal(documentRevision(applied.readback.catalog), plan.expectedOutputs[0].revision);
    assert.deepEqual(
      applied.readback.catalog,
      JSON.parse(await readFile(fixture.catalog, "utf8")),
    );
    assert.deepEqual(
      applied.readback.config,
      JSON.parse(await readFile(fixture.config, "utf8")),
    );
    assert.deepEqual(
      applied.readback.localState,
      JSON.parse(await readFile(fixture.state, "utf8")),
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
