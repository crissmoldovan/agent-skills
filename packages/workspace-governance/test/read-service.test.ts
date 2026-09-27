import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadService, READ_TOOL_NAMES } from "../src/read-service.ts";
import { createMcpFixture } from "./mcp-fixture.ts";

const expectedTools = [
  "workspace_doctor", "workspace_list", "workspace_where", "workspace_context",
  "workspace_explain", "workspace_open", "workspace_workflow", "workspace_operation",
];

test("read service exposes the complete typed read-only surface through fixed config", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-read-service-"));
  try {
    const fixture = await createMcpFixture(root);
    const service = createReadService({ configPath: fixture.configPath, env: { PATH: process.env.PATH } });
    assert.deepEqual(READ_TOOL_NAMES, expectedTools);
    assert.equal(Object.isFrozen(service.capabilities), true);
    assert.deepEqual(service.capabilities, { mode: "read-only", plans: false, apply: false });

    const before = await fixture.snapshot();
    const listed = await service.execute("workspace_list", { view: "catalog" });
    assert.equal(listed.body.command, "list");
    assert.equal((listed.body.counts as { total: number }).total, 1);
    const groups = await service.execute("workspace_list", { view: "groups" });
    assert.equal((groups.body.groups as unknown[]).length, 2);
    const repositories = await service.execute("workspace_list", { view: "repositories" });
    assert.equal((repositories.body.repositories as unknown[]).length, 1);
    const coverage = await service.execute("workspace_list", { view: "coverage", roots: [fixture.repositoryPath], depth: 1 });
    assert.equal(coverage.body.command, "list");
    assert.equal((coverage.body.coverage as { selected: boolean }).selected, true);
    const where = await service.execute("workspace_where", { target: "service" });
    assert.equal((where.body.repository as { id: string }).id, "repo");
    const context = await service.execute("workspace_context", { repository: "repo" });
    assert.equal(((context.body.context as { settings: Record<string, string> }).settings)["commands.test"], "npm test");
    const explanation = await service.execute("workspace_explain", { repository: "repo", field: "commands.test" });
    assert.deepEqual((explanation.body.context as { settings: object }).settings, { "commands.test": "npm test" });
    const opened = await service.execute("workspace_open", { target: "repo" });
    assert.equal(((opened.body.open as { hostAction: unknown }).hostAction), null);
    const workflows = await service.execute("workspace_workflow", { action: "list", repository: "repo", workspace: "ws" });
    assert.equal((workflows.body.workflows as unknown[]).length, 1);
    const workflow = await service.execute("workspace_workflow", { action: "show", repository: "repo", workspace: "ws", workflow: "feature" });
    assert.equal((workflow.body.workflow as { executable: boolean }).executable, true);
    const status = await service.execute("workspace_workflow", { action: "status", run: fixture.runId });
    assert.equal((status.body.run as { status: string; validity: string }).status, "completed");
    assert.equal((status.body.run as { status: string; validity: string }).validity, "current");
    const worktrees = await service.execute("workspace_operation", { action: "worktrees", repository: "repo" });
    assert.ok((worktrees.body.worktrees as unknown[]).length >= 1);
    const doctor = await service.execute("workspace_doctor", {});
    assert.equal(doctor.body.command, "doctor");
    assert.equal((doctor.body.mcp as { mode: string }).mode, "read-only");
    assert.equal(await fixture.snapshot(), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("read service rejects caller config, argv, env, unknown fields, invalid unions, and oversized values", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-read-service-invalid-"));
  try {
    const fixture = await createMcpFixture(root);
    const service = createReadService({ configPath: fixture.configPath, env: { PATH: process.env.PATH } });
    const before = await fixture.snapshot();
    for (const [tool, input] of [
      ["workspace_list", { view: "catalog", config: "/tmp/other" }],
      ["workspace_list", { view: "coverage" }],
      ["workspace_list", { view: "coverage", roots: [] }],
      ["workspace_list", { view: "coverage", sources: [] }],
      ["workspace_list", { view: "coverage", sources: ["source"], depth: 1 }],
      ["workspace_list", { view: "coverage", roots: [fixture.repositoryPath], maxPages: 1 }],
      ["workspace_where", { target: "repo", argv: ["apply"] }],
      ["workspace_context", { repository: "repo", env: { WORKSPACECTL_CONFIG: "/tmp/other" } }],
      ["workspace_workflow", { action: "run", repository: "repo", workspace: "ws" }],
      ["workspace_open", { target: `repo${"x".repeat(4097)}` }],
      ["workspace_where", { target: "--config" }],
      ["workspace_operation", { action: "reconcile", operation: "operation-1" }],
    ] as const) {
      await assert.rejects(() => service.execute(tool as never, input), { code: "INVALID_CONFIG" });
    }
    await assert.rejects(() => service.execute("workspace_apply_plan" as never, {}), { code: "UNSUPPORTED" });
    assert.equal(await fixture.snapshot(), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
