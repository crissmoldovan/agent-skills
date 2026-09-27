import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyWorkspacePlan, createInitPlan, createPortableImportPlan } from "../src/registry-plans.ts";
import { FileCatalogStore, FileLocalStateStore, writeCatalogDocument } from "../src/document-stores.ts";
import { createPortableDocument, rfc8785Canonicalize } from "../src/portable.ts";
import { emptyCatalogDocument, type CatalogDocument } from "../src/v2-model.ts";
import { runV2Cli } from "../src/v2-cli.ts";
import { createGovernanceService } from "../src/mcp-service.ts";
import { fileURLToPath } from "node:url";

const logicalCatalog = (): CatalogDocument => ({ ...emptyCatalogDocument(), groups: [{ id: "org", kind: "organization", name: "Org", slug: "org", parentId: null, metadata: {} }], repositories: [{ id: "repo", remote: "https://github.com/acme/repo.git", sourceId: null, primaryGroupId: "org", memberOf: [], aliases: ["service"], classification: "confirmed", metadata: {} }] });

const appendDuplicateExpectedOutput = (document: any, stepIndex: number) => {
  const workflow = document.logical.workflows[0];
  const step = workflow.steps[stepIndex];
  const field = `configuration.expectedOutputs.${step.configuration.expectedOutputs.length}.path`;
  const ownerId = `${workflow.scope.kind}:${workflow.scope.id}:${workflow.id}:${step.id}`;
  const id = `binding-${createHash("sha256").update(`path\0workflow-step\0${ownerId}\0${field}`).digest("hex").slice(0, 24)}`;
  const dependant = { kind: "workflow-step", id: ownerId, field };
  step.configuration.expectedOutputs.push({ id: step.configuration.expectedOutputs[0].id, path: `needs-binding:${id}` });
  const priorIndex = document.unresolvedBindings.findIndex((binding: any) =>
    binding.provenance.ownerId === ownerId && binding.provenance.field === `configuration.expectedOutputs.${step.configuration.expectedOutputs.length - 2}.path`);
  document.unresolvedBindings.splice(priorIndex + 1, 0, {
    id, status: "needs-binding", sourceKind: "path",
    provenance: { ownerKind: "workflow-step", ownerId, field },
    dependants: [dependant],
  });
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "portable-destination-home-"));
  const dirs = Object.fromEntries(["config", "data", "state", "plans", "workspaces", "incoming"].map(name => [name, join(root, name)]));
  await Promise.all(Object.values(dirs).map(path => mkdir(path, { mode: 0o700 })));
  const init = { configPath: join(dirs.config, "config.json"), catalogPath: join(dirs.data, "catalog.json"), localStatePath: join(dirs.state, "state.json"), plansDirectory: dirs.plans, trustedRoots: [dirs.workspaces] };
  const initPlan = await createInitPlan(init, "2026-09-26T00:00:00.000Z");
  await applyWorkspacePlan(initPlan, { selectedConfigPath: init.configPath, approval: initPlan.id });
  const portablePath = join(dirs.incoming, "portable.json");
  await writeFile(portablePath, JSON.stringify(createPortableDocument(logicalCatalog(), "2026-09-26T00:01:00.000Z", "0.3.0-dev")) + "\n", { mode: 0o600 });
  return { root, init, portablePath, dirs };
}

test("portable import is a complete reviewed replacement and preserves destination local state", async () => {
  const value = await fixture();
  try {
    const stateBefore = await new FileLocalStateStore(value.init.localStatePath).read();
    const plan = await createPortableImportPlan({ configPath: value.init.configPath, portablePath: value.portablePath }, "2026-09-26T00:02:00.000Z");
    assert.equal(plan.kind, "catalog-edit");
    assert.equal(plan.request.portablePath, value.portablePath);
    assert.ok((plan.request.catalogChange as any).changedRecords.length > 0);
    const result = await applyWorkspacePlan(plan, { selectedConfigPath: value.init.configPath, approval: plan.id });
    assert.deepEqual(result.readback.catalog.groups.map(group => group.id), ["org"]);
    assert.deepEqual(result.readback.catalog.repositories.map(repo => repo.id), ["repo"]);
    assert.equal(result.revisions.localState, stateBefore.revision);
    assert.deepEqual(result.readback.localState, stateBefore.document);
  } finally { await rm(value.root, { recursive: true, force: true }); }
});

test("portable import refuses tamper or stale destination without partial replacement", async () => {
  const value = await fixture();
  try {
    const plan = await createPortableImportPlan({ configPath: value.init.configPath, portablePath: value.portablePath }, "2026-09-26T00:02:00.000Z");
    await writeFile(value.portablePath, "{}\n", { mode: 0o600 });
    await assert.rejects(() => applyWorkspacePlan(plan, { selectedConfigPath: value.init.configPath, approval: plan.id }), { code: "STALE_PLAN" });
    assert.deepEqual((await new FileCatalogStore(value.init.catalogPath).read()).document, emptyCatalogDocument());
  } finally { await rm(value.root, { recursive: true, force: true }); }
});

test("portable import planning atomically refuses valid-digest dangling graphs", async () => {
  const value = await fixture();
  try {
    const malformedCatalog = logicalCatalog();
    malformedCatalog.policies = [{
      scope: { kind: "repository", id: "repo" }, settings: {}, operations: [], constraints: [], instructions: [], knowledge: [], skills: [],
      provenance: { sourceRepository: "repo", sourcePath: "/source/policy.json", sourceRevision: "rev", contentDigest: "a".repeat(64), declaredScope: { kind: "repository", id: "repo" } },
    }];
    malformedCatalog.workflows = [{
      id: "flow", scope: { kind: "repository", id: "repo" }, inputs: [], outputs: [{ id: "artifact", required: true }], settings: {}, operations: [], constraints: [],
      steps: [{ id: "verify", type: "verify", needs: [], configuration: { checks: [{ type: "file", path: "artifact.json", content: "ok", outputId: "artifact" }] }, sideEffect: "none", approval: "none", retry: { mode: "never", maxAttempts: 1 }, required: true }],
    }];
    const base: any = createPortableDocument(malformedCatalog, "2026-09-26T00:01:00.000Z", "0.3.0-dev");
    const mutations = [
      (document: any) => { document.logical.workflows[0].steps[0].configuration.checks[0].outputId = "ghost-output"; },
      (document: any) => { document.logical.policies[0].provenance.sourceRepository = "missing-repository"; },
      (document: any) => { document.logical.policies[0].provenance.sourceRepository = "https://github.com/external/rules.git"; },
    ];

    const governedPaths = [value.init.configPath, value.init.catalogPath, value.init.localStatePath];
    const bytesBefore = await Promise.all(governedPaths.map(path => readFile(path)));
    const plansBefore = await readdir(value.dirs.plans);
    for (const mutate of mutations) {
      const malicious = structuredClone(base);
      mutate(malicious);
      const unsigned = structuredClone(malicious); delete unsigned.digest;
      malicious.digest = `sha256:${createHash("sha256").update(rfc8785Canonicalize(unsigned)).digest("hex")}`;
      await writeFile(value.portablePath, JSON.stringify(malicious) + "\n", { mode: 0o600 });
      await assert.rejects(
        () => createPortableImportPlan({ configPath: value.init.configPath, portablePath: value.portablePath }, "2026-09-26T00:02:00.000Z"),
        { code: "INVALID_CONFIG" },
      );
      assert.deepEqual(await Promise.all(governedPaths.map(path => readFile(path))), bytesBefore);
      assert.deepEqual(await readdir(value.dirs.plans), plansBefore);
    }
  } finally { await rm(value.root, { recursive: true, force: true }); }
});

test("portable import planning atomically refuses valid-digest duplicate expected-output identities", async () => {
  const value = await fixture();
  try {
    const source = logicalCatalog();
    source.workflows = [{
      id: "flow", scope: { kind: "repository", id: "repo" }, inputs: [], outputs: [{ id: "artifact", required: true }], settings: {}, operations: [], constraints: [],
      steps: [
        { id: "agent", type: "agent.task", needs: [], configuration: { target: "agent", objective: "produce", expectedOutputs: [{ id: "artifact", path: "agent-one.json" }], verification: [] }, sideEffect: "none", approval: "none", retry: { mode: "never", maxAttempts: 1 }, required: true },
        { id: "external", type: "external.action", needs: [], configuration: { target: "service", objective: "produce", expectedOutputs: [{ id: "artifact", path: "external-one.json" }], verification: [] }, sideEffect: "external", approval: "explicit", retry: { mode: "never", maxAttempts: 1 }, required: true },
      ],
    }] as any;
    const base: any = createPortableDocument(source, "2026-09-26T00:01:00.000Z", "0.3.0-dev");
    const governedPaths = [value.init.configPath, value.init.catalogPath, value.init.localStatePath];
    const bytesBefore = await Promise.all(governedPaths.map(path => readFile(path)));
    const plansBefore = await readdir(value.dirs.plans);

    for (const stepIndex of [0, 1]) {
      const malicious = structuredClone(base);
      appendDuplicateExpectedOutput(malicious, stepIndex);
      const unsigned = structuredClone(malicious); delete unsigned.digest;
      malicious.digest = `sha256:${createHash("sha256").update(rfc8785Canonicalize(unsigned)).digest("hex")}`;
      await writeFile(value.portablePath, JSON.stringify(malicious) + "\n", { mode: 0o600 });
      await assert.rejects(
        () => createPortableImportPlan({ configPath: value.init.configPath, portablePath: value.portablePath }, "2026-09-26T00:02:00.000Z"),
        { code: "INVALID_CONFIG" },
      );
      assert.deepEqual(await Promise.all(governedPaths.map(path => readFile(path))), bytesBefore);
      assert.deepEqual(await readdir(value.dirs.plans), plansBefore);
    }
  } finally { await rm(value.root, { recursive: true, force: true }); }
});

test("nonempty portable replacement exposes complete diff and stale destination CAS preserves winner", async () => {
  const value = await fixture();
  try {
    const store = new FileCatalogStore(value.init.catalogPath);
    const initial = await store.read();
    const oldCatalog: CatalogDocument = { ...emptyCatalogDocument(), groups: [{ id: "old", kind: "organization", name: "Old", slug: "old", parentId: null, metadata: {} }] };
    await writeCatalogDocument(store, initial.revision, oldCatalog);
    const plan = await createPortableImportPlan({ configPath: value.init.configPath, portablePath: value.portablePath }, "2026-09-26T00:02:00.000Z");
    const changes = (plan.request.catalogChange as any).changedRecords;
    assert.ok(changes.some((change: any) => change.id === "old" && change.before !== null && change.after === null));
    assert.ok(changes.some((change: any) => change.id === "org" && change.before === null && change.after !== null));
    const current = await store.read();
    const winner: CatalogDocument = { ...emptyCatalogDocument(), groups: [{ id: "winner", kind: "organization", name: "Winner", slug: "winner", parentId: null, metadata: {} }] };
    await writeCatalogDocument(store, current.revision, winner);
    await assert.rejects(() => applyWorkspacePlan(plan, { selectedConfigPath: value.init.configPath, approval: plan.id }), { code: "CONFLICT" });
    assert.deepEqual((await store.read()).document, winner);
  } finally { await rm(value.root, { recursive: true, force: true }); }
});

test("portable CLI and typed MCP planning expose fixed export/import actions", async () => {
  const value = await fixture();
  try {
    const cliPlan = join(value.dirs.plans, "cli-import.json");
    const preview = await runV2Cli(["portable", "import", "--config", value.init.configPath, "--input", value.portablePath, "--plan", cliPlan, "--json"]);
    assert.equal(preview.body?.command, "portable import");
    assert.equal(preview.body?.applied, false);

    const trustedPortable = join(value.dirs.workspaces, "portable.json");
    await writeFile(trustedPortable, await readFile(value.portablePath), { mode: 0o600 });
    const service = createGovernanceService({ configPath: value.init.configPath, allowPlans: true });
    const planned = await service.execute("workspace_plan", { operation: "portable-import", portable: trustedPortable });
    assert.equal(planned.body.command, "workspace_plan");
    assert.equal(planned.body.operation, "portable-import");

    const exportedPath = join(value.dirs.incoming, "exported.json");
    const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    const exported = spawnSync(process.execPath, [cli, "portable", "export", "--config", value.init.configPath, "--output", exportedPath, "--json"], { encoding: "utf8" });
    assert.equal(exported.status, 0, exported.stderr);
    assert.equal(JSON.parse(exported.stdout).command, "portable export");
    assert.equal(JSON.parse(await readFile(exportedPath, "utf8")).format, "workspacectl-portable/1");
  } finally { await rm(value.root, { recursive: true, force: true }); }
});
