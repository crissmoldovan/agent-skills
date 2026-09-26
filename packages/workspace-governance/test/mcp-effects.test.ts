import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpFixture } from "./mcp-fixture.ts";
import { createGovernanceService } from "../src/mcp-service.ts";
import { createMcpServer } from "../src/mcp-server.ts";
import { canonicalJson } from "../src/core.ts";
import { documentRevision } from "../src/v2-model.ts";

const planTools = ["workspace_plan"];
const effectTools = [
  "workspace_apply_plan", "workspace_workflow_approve", "workspace_workflow_interrupt",
  "workspace_workflow_resume", "workspace_workflow_run", "workspace_workflow_submit",
];

async function toolNames(service: ReturnType<typeof createGovernanceService>) {
  const server: any = createMcpServer(service);
  return Object.keys(server._registeredTools).sort();
}

test("startup capabilities immutably gate advertised plan and effect tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-mcp-modes-"));
  try {
    const fixture = await createMcpFixture(root);
    const read = createGovernanceService({ configPath: fixture.configPath });
    const plans = createGovernanceService({ configPath: fixture.configPath, allowPlans: true });
    const apply = createGovernanceService({ configPath: fixture.configPath, allowApply: true });
    assert.deepEqual(read.capabilities, { mode: "read-only", plans: false, apply: false });
    assert.deepEqual(plans.capabilities, { mode: "plans", plans: true, apply: false });
    assert.deepEqual(apply.capabilities, { mode: "effects", plans: true, apply: true });
    assert.deepEqual((await toolNames(plans)).filter(name => planTools.includes(name)), planTools);
    assert.deepEqual((await toolNames(read)).filter(name => [...planTools, ...effectTools].includes(name)), []);
    assert.deepEqual((await toolNames(apply)).filter(name => effectTools.includes(name)), effectTools);
    assert.ok(Object.isFrozen(apply.capabilities));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("workflow input map accepts 32 bounded names and refuses malformed or 33-entry maps without mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-mcp-input-bounds-"));
  try {
    const fixture = await createMcpFixture(root);
    const catalog = JSON.parse(await readFile(fixture.catalogPath, "utf8"));
    catalog.workflows[0].inputs = Array.from({ length: 32 }, (_, index) => ({ id: `k${index}`, required: false }));
    await writeFile(fixture.catalogPath, JSON.stringify(catalog) + "\n");
    const service = createGovernanceService({ configPath: fixture.configPath, allowApply: true });
    const before = await fixture.snapshot();
    const inputs32 = Object.fromEntries(Array.from({ length: 32 }, (_, index) => [`k${index}`, "v"]));
    await assert.rejects(() => service.execute("workspace_workflow_run", { repository: "repo", workspace: "ws", workflow: "feature", inputs: { ...inputs32, k32: "v" } }), { code: "INVALID_CONFIG" });
    await assert.rejects(() => service.execute("workspace_workflow_run", { repository: "repo", workspace: "ws", workflow: "feature", inputs: { "-bad": "v" } }), { code: "INVALID_CONFIG" });
    assert.equal(await fixture.snapshot(), before);
    const accepted: any = (await service.execute("workspace_workflow_run", { repository: "repo", workspace: "ws", workflow: "feature", inputs: inputs32 })).body;
    assert.deepEqual(accepted.run.inputs, inputs32);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("private opaque adopt plan requires exact approval and selected config", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-mcp-adopt-"));
  try {
    const fixture = await createMcpFixture(root);
    const catalog = JSON.parse(await readFile(fixture.catalogPath, "utf8"));
    catalog.repositories.push({ id: "other", remote: "https://github.com/example/other", sourceId: null, primaryGroupId: "project", memberOf: [], aliases: [], classification: "confirmed", metadata: {} });
    await writeFile(fixture.catalogPath, JSON.stringify(catalog) + "\n");
    const checkout = join(root, "trusted", "other");
    execFileSync("git", ["init", "-q", "-b", "main", checkout]);
    execFileSync("git", ["-C", checkout, "remote", "add", "origin", "https://github.com/example/other.git"]);
    const service = createGovernanceService({ configPath: fixture.configPath, allowApply: true });
    await assert.rejects(() => service.execute("workspace_plan", { operation: "adopt", repository: "other", path: checkout, branch: "ignored" } as any));
    const planned = await service.execute("workspace_plan", { operation: "adopt", repository: "other", path: checkout });
    const body: any = planned.body;
    assert.equal(body.applied, false);
    assert.match(body.plan, /^mcp-[a-f0-9]{32}$/);
    assert.equal(body.planPath, undefined);
    assert.equal(body.preview.kind, "adopt");
    await assert.rejects(() => service.execute("workspace_apply_plan", { plan: body.plan, approval: "wrong" }));
    let state = JSON.parse(await readFile(fixture.statePath, "utf8"));
    assert.equal(state.repositoryWorkspaces.some((item: any) => item.repositoryId === "other"), false);
    const applied = await service.execute("workspace_apply_plan", { plan: body.plan, approval: body.approval });
    assert.equal((applied.body as any).applied, true);
    state = JSON.parse(await readFile(fixture.statePath, "utf8"));
    assert.equal(state.repositoryWorkspaces.some((item: any) => item.repositoryId === "other" && item.path === checkout), true);
    await assert.rejects(() => service.execute("workspace_apply_plan", { plan: "../escape", approval: body.approval }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("guarded checkout, move, and worktree plans apply with exact readback", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-mcp-git-effects-"));
  try {
    const fixture = await createMcpFixture(root);
    await writeFile(join(fixture.repositoryPath, "tracked.txt"), "one\n");
    execFileSync("git", ["-C", fixture.repositoryPath, "-c", "user.name=MCP", "-c", "user.email=mcp@example.invalid", "add", "."]);
    execFileSync("git", ["-C", fixture.repositoryPath, "-c", "user.name=MCP", "-c", "user.email=mcp@example.invalid", "commit", "-qm", "fixture"]);
    const bare = join(root, "trusted", "remote.git");
    execFileSync("git", ["clone", "-q", "--bare", fixture.repositoryPath, bare]);
    const unboundState = JSON.parse(await readFile(fixture.statePath, "utf8"));
    unboundState.repositoryWorkspaces = [];
    await writeFile(fixture.statePath, JSON.stringify(unboundState) + "\n");
    const rewrite = `file://${bare}`;
    const gitEnv = {
      GIT_ALLOW_PROTOCOL: "file",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.${rewrite}.insteadOf`,
      GIT_CONFIG_VALUE_0: "https://github.com/example/repo",
    };
    Object.assign(process.env, gitEnv);
    const service = createGovernanceService({
      configPath: fixture.configPath,
      allowApply: true,
      env: { ...process.env },
    });
    const destination = join(root, "trusted", "clone");
    let planned: any = (await service.execute("workspace_plan", { operation: "checkout", repository: "repo", destination })).body;
    let applied: any = (await service.execute("workspace_apply_plan", { plan: planned.plan, approval: planned.approval })).body;
    assert.equal(applied.kind, "checkout");
    assert.equal(await readFile(join(destination, "tracked.txt"), "utf8"), "one\n");
    const stateAfterCheckout = JSON.parse(await readFile(fixture.statePath, "utf8"));
    const checkedOut = stateAfterCheckout.repositoryWorkspaces.find((item: any) => item.path === destination);
    assert.ok(checkedOut);
    const moved = join(root, "trusted", "moved");
    await assert.rejects(() => service.execute("workspace_plan", { operation: "move", workspace: checkedOut.id, destination: moved }));
    planned = (await service.execute("workspace_plan", { operation: "move", workspace: checkedOut.id, destination: moved, confirmInactive: true })).body;
    applied = (await service.execute("workspace_apply_plan", { plan: planned.plan, approval: planned.approval })).body;
    assert.equal(applied.kind, "checkout-move");
    assert.equal(await readFile(join(moved, "tracked.txt"), "utf8"), "one\n");
    const commit = execFileSync("git", ["-C", fixture.repositoryPath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const worktreePath = join(root, "trusted", "worktree");
    planned = (await service.execute("workspace_plan", { operation: "worktree-create", repository: "repo", base: commit, branch: "mcp-worktree", path: worktreePath })).body;
    applied = (await service.execute("workspace_apply_plan", { plan: planned.plan, approval: planned.approval })).body;
    assert.equal(applied.kind, "worktree-create");
    const stateWithWorktree = JSON.parse(await readFile(fixture.statePath, "utf8"));
    const worktree = stateWithWorktree.repositoryWorkspaces.find((item: any) => item.path === worktreePath);
    assert.ok(worktree);
    await assert.rejects(() => service.execute("workspace_plan", { operation: "worktree-remove", workspace: worktree.id }));
    planned = (await service.execute("workspace_plan", { operation: "worktree-remove", workspace: worktree.id, confirmInactive: true })).body;
    applied = (await service.execute("workspace_apply_plan", { plan: planned.plan, approval: planned.approval })).body;
    assert.equal(applied.kind, "worktree-remove");
    const finalState = JSON.parse(await readFile(fixture.statePath, "utf8"));
    assert.equal(finalState.repositoryWorkspaces.some((item: any) => item.id === worktree.id), false);
  } finally {
    for (const name of ["GIT_ALLOW_PROTOCOL", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"]) delete process.env[name];
    await rm(root, { recursive: true, force: true });
  }
});

test("tampered, stale, and cross-config opaque plans refuse without mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-mcp-refusals-"));
  try {
    const first = await createMcpFixture(join(root, "first"));
    const second = await createMcpFixture(join(root, "second"));
    const service = createGovernanceService({ configPath: first.configPath, allowApply: true });
    const other = createGovernanceService({ configPath: second.configPath, allowApply: true });
    let planned: any = (await service.execute("workspace_plan", { operation: "select-primary", repository: "repo", workspace: "ws" })).body;
    const before = await readFile(first.statePath);
    await assert.rejects(() => other.execute("workspace_apply_plan", { plan: planned.plan, approval: planned.approval }));
    const planPath = join(first.root, "plans", `${planned.plan}.json`);
    const bytes = JSON.parse(await readFile(planPath, "utf8"));
    bytes.actions = [];
    await writeFile(planPath, JSON.stringify(bytes) + "\n");
    await assert.rejects(() => service.execute("workspace_apply_plan", { plan: planned.plan, approval: planned.approval }));
    assert.deepEqual(await readFile(first.statePath), before);
    planned = (await service.execute("workspace_plan", { operation: "select-primary", repository: "repo", workspace: "ws" })).body;
    const state = JSON.parse(await readFile(first.statePath, "utf8"));
    state.metadata.changedAfterPlan = true;
    await writeFile(first.statePath, JSON.stringify(state) + "\n");
    const staleBefore = await readFile(first.statePath);
    await assert.rejects(() => service.execute("workspace_apply_plan", { plan: planned.plan, approval: planned.approval }));
    assert.deepEqual(await readFile(first.statePath), staleBefore);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("workflow approve and interrupt preserve exact binding without replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-mcp-interrupt-"));
  try {
    const fixture = await createMcpFixture(root);
    const catalog = JSON.parse(await readFile(fixture.catalogPath, "utf8"));
    catalog.workflows[0].steps = [{
      id: "external", type: "external.action", needs: [],
      configuration: { target: "synthetic-api", objective: "perform once", expectedOutputs: [{ id: "out", path: "receipt.json" }], verification: [{ type: "json-file", path: "receipt.json", fields: { id: "receipt-1" } }] },
      sideEffect: "external", approval: "explicit", retry: { mode: "never", maxAttempts: 1 }, required: true,
    }];
    await writeFile(fixture.catalogPath, JSON.stringify(catalog) + "\n");
    const service = createGovernanceService({ configPath: fixture.configPath, allowApply: true });
    const started: any = (await service.execute("workspace_workflow_run", { repository: "repo", workspace: "ws", workflow: "feature", inputs: {} })).body;
    const pending = started.run.pending;
    const binding = { run: started.run.id, step: pending.stepId, attempt: pending.attemptId, digest: pending.requestDigest };
    await assert.rejects(() => service.execute("workspace_workflow_approve", { ...binding, digest: "wrong" }));
    const approved: any = (await service.execute("workspace_workflow_approve", binding)).body;
    assert.equal(approved.run.approvals.includes(pending.requestDigest), true);
    const interrupted: any = (await service.execute("workspace_workflow_interrupt", binding)).body;
    assert.equal(interrupted.run.status, "interrupted");
    assert.equal(interrupted.run.steps[0].attempts, 1);
    await assert.rejects(() => service.execute("workspace_workflow_resume", { run: started.run.id }));
    const receipt = join(fixture.repositoryPath, "receipt.json");
    await writeFile(receipt, JSON.stringify({ id: "receipt-1" }) + "\n");
    const inspected: any = (await service.execute("workspace_workflow_submit", { ...binding, outcome: "unknown", evidence: [receipt] })).body;
    assert.equal(inspected.run.status, "interrupted");
    assert.equal(inspected.run.steps[0].attempts, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("coordination workflow binds both exact members and repository-local handoff context", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-mcp-coordination-"));
  try {
    const plans = join(root, "plans"), coordination = join(root, "coordination"), api = join(root, "api"), web = join(root, "web");
    await Promise.all([plans, coordination, api, web].map(path => mkdir(path, { recursive: true })));
    for (const [id, path] of [["api", api], ["web", web]] as const) {
      execFileSync("git", ["init", "-q", "-b", "main", path]);
      await writeFile(join(path, "tracked.txt"), `${id}\n`);
      execFileSync("git", ["-C", path, "-c", "user.name=MCP", "-c", "user.email=mcp@example.invalid", "add", "."]);
      execFileSync("git", ["-C", path, "-c", "user.name=MCP", "-c", "user.email=mcp@example.invalid", "commit", "-qm", "fixture"]);
      execFileSync("git", ["-C", path, "remote", "add", "origin", `https://github.com/example/${id}.git`]);
    }
    const configPath = join(root, "config.json"), catalogPath = join(root, "catalog.json"), statePath = join(root, "state.json");
    const config = { schemaVersion: 2, documentType: "workspacectl/config", catalog: { adapter: "file", path: catalogPath }, localState: { adapter: "file", path: statePath }, plans: { directory: plans }, trustedRoots: [root] };
    const members = [{ repositoryId: "api", workspaceId: "ws-api", path: api }, { repositoryId: "web", workspaceId: "ws-web", path: web }];
    const bindingBase = { id: "coord", kind: "coordination", scope: { kind: "project", id: "project" }, path: coordination, memberRepositoryIds: ["api", "web"], memberWorkspaceIds: ["ws-api", "ws-web"], hostProjectId: null, generatedFiles: ["WORKSPACE.md", "members.json"] };
    const binding = { ...bindingBase, revision: `sha256:${createHash("sha256").update(canonicalJson(bindingBase as any)).digest("hex")}` };
    await writeFile(join(coordination, "WORKSPACE.md"), "# Coordination\n");
    await writeFile(join(coordination, "members.json"), JSON.stringify({ schemaVersion: 1, workspaceId: "coord", scope: binding.scope, members }) + "\n");
    const workflow = { id: "delivery", scope: { kind: "project", id: "project" }, inputs: [], outputs: [{ id: "result", required: true }], settings: {}, operations: [], constraints: [], steps: [
      { id: "coordination", type: "coordination.check", needs: [], configuration: { coordinationWorkspaceId: "coord", memberWorkspaceIds: ["ws-api", "ws-web"] }, sideEffect: "none", approval: "none", retry: { mode: "never", maxAttempts: 1 }, required: true },
      { id: "api-context", type: "context.resolve", needs: ["coordination"], configuration: { repositoryId: "api", workspaceId: "ws-api" }, sideEffect: "none", approval: "none", retry: { mode: "never", maxAttempts: 1 }, required: true },
      { id: "web-context", type: "context.resolve", needs: ["api-context"], configuration: { repositoryId: "web", workspaceId: "ws-web" }, sideEffect: "none", approval: "none", retry: { mode: "never", maxAttempts: 1 }, required: true },
      { id: "agent", type: "agent.task", needs: ["web-context"], configuration: { repositoryId: "api", workspaceId: "ws-api", target: "builder", objective: "write result", expectedOutputs: [{ id: "result", path: "result.json" }], verification: [{ type: "json-file", path: "result.json", fields: { repository: "api" } }] }, sideEffect: "none", approval: "none", retry: { mode: "never", maxAttempts: 1 }, required: true },
    ] };
    const groups = [{ id: "org", kind: "organization", name: "Org", slug: "org", parentId: null, metadata: {} }, { id: "project", kind: "project", name: "Project", slug: "project", parentId: "org", metadata: {} }];
    const repositories = members.map(member => ({ id: member.repositoryId, remote: `https://github.com/example/${member.repositoryId}`, sourceId: null, primaryGroupId: "project", memberOf: [], aliases: [], classification: "confirmed", metadata: {} }));
    const catalog = { schemaVersion: 2, documentType: "workspacectl/catalog", groups, repositories, sources: [], policies: [], workflows: [workflow], metadata: {} };
    const state = { schemaVersion: 2, documentType: "workspacectl/local-state", selectedConfig: { path: configPath, revision: documentRevision(config as any) }, repositoryWorkspaces: members.map(member => ({ id: member.workspaceId, kind: "primary", repositoryId: member.repositoryId, path: member.path, branch: "main", primarySelected: true, hostLinks: {} })), coordinationWorkspaces: [binding], workspacePolicyOverlays: [], workspaceWorkflowOverlays: [], trustedInputApprovals: [], planReferences: [], runReferences: [], metadata: {} };
    await Promise.all([writeFile(configPath, JSON.stringify(config) + "\n"), writeFile(catalogPath, JSON.stringify(catalog) + "\n"), writeFile(statePath, JSON.stringify(state) + "\n")]);
    const service = createGovernanceService({ configPath, allowApply: true });
    let run: any = (await service.execute("workspace_workflow_run", { coordination: "coord", workflow: "delivery", inputs: {} })).body;
    assert.deepEqual(run.run.members.map((member: any) => member.repositoryId), ["api", "web"]);
    assert.equal(run.run.pending.repositoryId, "api");
    assert.equal(run.run.pending.workspacePath, api);
    await writeFile(join(api, "result.json"), JSON.stringify({ repository: "api" }) + "\n");
    const pending = run.run.pending;
    run = (await service.execute("workspace_workflow_submit", { run: run.run.id, step: pending.stepId, attempt: pending.attemptId, digest: pending.requestDigest, outcome: "completed", evidence: [join(api, "result.json")] })).body;
    run = (await service.execute("workspace_workflow_resume", { run: run.run.id })).body;
    assert.equal(run.run.status, "completed");
    assert.equal(run.run.steps.find((step: any) => step.id === "coordination").status, "completed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("workflow tools preserve exact pending binding and completed runs do not replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-mcp-workflow-"));
  try {
    const fixture = await createMcpFixture(root);
    const catalog = JSON.parse(await readFile(fixture.catalogPath, "utf8"));
    catalog.workflows[0].steps = [{
      id: "agent", type: "agent.task", needs: [],
      configuration: { target: "builder", objective: "write evidence", expectedOutputs: [{ id: "out", path: "evidence.txt" }], verification: [{ type: "file", path: "evidence.txt", content: "ok\n" }] },
      sideEffect: "none", approval: "none", retry: { mode: "never", maxAttempts: 1 }, required: true,
    }];
    await writeFile(fixture.catalogPath, JSON.stringify(catalog) + "\n");
    const service = createGovernanceService({ configPath: fixture.configPath, allowApply: true });
    const started: any = (await service.execute("workspace_workflow_run", { repository: "repo", workspace: "ws", workflow: "feature", inputs: {} })).body;
    const pending = started.run.pending;
    assert.equal(started.run.status, "waiting-for-agent");
    await assert.rejects(() => service.execute("workspace_workflow_submit", { run: started.run.id, step: pending.stepId, attempt: pending.attemptId, digest: "bad", outcome: "completed", evidence: [join(fixture.repositoryPath, "evidence.txt")] }));
    await writeFile(join(fixture.repositoryPath, "evidence.txt"), "ok\n");
    const submitted: any = (await service.execute("workspace_workflow_submit", { run: started.run.id, step: pending.stepId, attempt: pending.attemptId, digest: pending.requestDigest, outcome: "completed", evidence: [join(fixture.repositoryPath, "evidence.txt")] })).body;
    assert.equal(submitted.run.steps[0].status, "claimed");
    const resumed: any = (await service.execute("workspace_workflow_resume", { run: started.run.id })).body;
    assert.equal(resumed.run.status, "completed");
    const replay: any = (await service.execute("workspace_workflow_resume", { run: started.run.id })).body;
    assert.equal(replay.run.status, "completed");
    assert.equal(replay.run.steps[0].attempts, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
