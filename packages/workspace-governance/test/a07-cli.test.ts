import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../src/index.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const tempRoot = join(process.env.TMPDIR ?? tmpdir(), "workspacectl-a07-tests");
const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
const emptyPolicy = (kind: string, id: string, settings: Record<string, unknown> = {}) => ({ scope: { kind, id }, settings, operations: [], constraints: [], instructions: [], knowledge: [], skills: [] });

test("A07 public draft route persists rules and context/explain report exact provenance and external drift", async () => {
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(join(tempRoot, "cli-"));
  try {
    const dirs = Object.fromEntries(["config", "data", "state", "plans", "drafts", "workspaces", "external"].map((name) => [name, join(root, name)]));
    await Promise.all(Object.values(dirs).map((path) => mkdir(path)));
    const config = join(dirs.config, "config.json"), catalog = join(dirs.data, "catalog.json"), state = join(dirs.state, "state.json");
    const initPlan = join(dirs.plans, "init.json");
    let outcome = run(["init", "--config", config, "--catalog", catalog, "--state", state, "--plans-dir", dirs.plans, "--trusted-root", dirs.workspaces, "--plan", initPlan, "--json"]);
    assert.equal(outcome.status, 0, outcome.stderr);
    const initId = JSON.parse(outcome.stdout).plan.id;
    assert.equal(run(["apply", "--config", config, "--plan", initPlan, "--approve", initId, "--json"]).status, 0);

    const carriedPolicy = { ...emptyPolicy("organization", "org", { "commands.test": "npm test", "git.requirePullRequest": true }), constraints: [{ id: "pr", key: "git.requirePullRequest", operator: "equals", value: true }], instructions: [{ id: "required", text: "Review changes", required: true }, { id: "optional", text: "Broad note", required: false }], knowledge: [{ id: "architecture", reference: "docs/architecture.md", required: false }], skills: [{ id: "tdd", reference: "test-driven-development", required: false }] };
    const sourceBytes = Buffer.from(JSON.stringify(carriedPolicy, null, 2) + "\n");
    const sourcePath = join(dirs.external, "shared-rules.json");
    await writeFile(sourcePath, sourceBytes);
    const sourceDigest = createHash("sha256").update(canonicalJson(carriedPolicy as any)).digest("hex");
    const exported = JSON.parse(run(["config", "export", "--target", "catalog", "--config", config]).stdout);
    exported.document.groups = [
      { id: "org", kind: "organization", name: "Org", slug: "org", parentId: null, metadata: {} },
      { id: "project", kind: "project", name: "Project", slug: "project", parentId: "org", metadata: {} },
    ];
    exported.document.repositories = [{ id: "repo", remote: "https://github.com/other-owner/repo", sourceId: null, primaryGroupId: "project", memberOf: [], aliases: [], classification: "confirmed", metadata: {} }];
    const provenance = { sourceRepository: "https://github.com/synthetic/source", sourcePath: "rules/shared.json", sourceRevision: "rev-1", contentDigest: sourceDigest, declaredScope: { kind: "organization", id: "org" } };
    exported.document.policies = [
      { ...carriedPolicy, provenance },
      { ...emptyPolicy("repository", "repo", { "commands.test": "npm run verify", "git.requirePullRequest": true }), instructions: [{ id: "optional", remove: true }, { id: "repository", text: "Repository note", required: false }] },
    ];
    exported.document.workflows = [
      { id: "feature", scope: { kind: "organization", id: "org" }, inputs: [], outputs: [], settings: { "commands.test": "npm run broad" }, operations: [], constraints: [], steps: [{ id: "check", type: "command", needs: [], configuration: { argv: ["npm", "test"] }, sideEffect: "workspace", approval: "explicit", retry: { mode: "never", maxAttempts: 1 }, required: false }] },
      { id: "feature", scope: { kind: "repository", id: "repo" }, inputs: [], outputs: [], settings: {}, operations: [], constraints: [], steps: [{ id: "check", type: "command", needs: [], configuration: { argv: ["npm", "run", "verify"] }, sideEffect: "workspace", approval: "explicit", retry: { mode: "never", maxAttempts: 1 }, required: false }] },
    ];
    const draft = join(dirs.drafts, "rules.json"), plan = join(dirs.plans, "rules.json");
    await writeFile(draft, JSON.stringify(exported, null, 2) + "\n");
    outcome = run(["config", "validate", draft, "--config", config, "--json"]);
    assert.equal(outcome.status, 0, outcome.stderr);
    outcome = run(["config", "plan", draft, "--config", config, "--plan", plan, "--json"]);
    assert.equal(outcome.status, 0, outcome.stderr);
    const preview = JSON.parse(outcome.stdout);
    assert.deepEqual(preview.plan.request.catalogChange.changedRecords.map((change: any) => change.section).sort(), ["groups", "groups", "policies", "policies", "repositories", "workflows", "workflows"]);
    outcome = run(["apply", "--config", config, "--plan", plan, "--approve", preview.plan.id, "--json"]);
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.deepEqual(JSON.parse(outcome.stdout).readback.catalog.policies, exported.document.policies);

    const userDraft = JSON.parse(run(["config", "export", "--target", "user", "--config", config]).stdout);
    assert.equal(userDraft.target, "user");
    userDraft.document.policies.push(emptyPolicy("user", "user", { "user.setting": true }));
    const userDraftPath = join(dirs.drafts, "user.json"), userPlanPath = join(dirs.plans, "user.json");
    await writeFile(userDraftPath, JSON.stringify(userDraft, null, 2) + "\n");
    assert.equal(run(["config", "validate", userDraftPath, "--config", config]).status, 0);
    outcome = run(["config", "plan", userDraftPath, "--config", config, "--plan", userPlanPath, "--json"]);
    assert.equal(outcome.status, 0, outcome.stderr);
    const userPlan = JSON.parse(outcome.stdout).plan;
    outcome = run(["apply", "--config", config, "--plan", userPlanPath, "--approve", userPlan.id, "--json"]);
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.equal(JSON.parse(outcome.stdout).readback.catalog.policies.some((entry: any) => entry.scope.kind === "user"), true);

    const local = JSON.parse(await readFile(state, "utf8"));
    local.repositoryWorkspaces.push({ id: "ws", kind: "primary", repositoryId: "repo", path: join(dirs.workspaces, "repo"), branch: "main", primarySelected: true, hostLinks: {} });
    local.workspaceWorkflowOverlays ??= [];
    await writeFile(state, JSON.stringify(local, null, 2) + "\n");
    const workspaceDraftResult = run(["config", "export", "--target", "workspace", "--workspace", "ws", "--config", config]);
    assert.equal(workspaceDraftResult.status, 0, workspaceDraftResult.stderr);
    const workspaceDraft = JSON.parse(workspaceDraftResult.stdout);
    workspaceDraft.document.workspacePolicyOverlays.push(emptyPolicy("workspace", "ws", { "workspace.setting": true }));
    workspaceDraft.document.workspaceWorkflowOverlays.push({ id: "feature", scope: { kind: "workspace", id: "ws" }, inputs: [], outputs: [], settings: { "workspace.workflow": true }, operations: [], constraints: [], steps: [{ id: "check", type: "command", needs: [], configuration: { argv: ["npm", "run", "workspace"] }, sideEffect: "workspace", approval: "explicit", retry: { mode: "never", maxAttempts: 1 }, required: false }] });
    const workspaceDraftPath = join(dirs.drafts, "workspace.json"), workspacePlanPath = join(dirs.plans, "workspace.json");
    await writeFile(workspaceDraftPath, JSON.stringify(workspaceDraft, null, 2) + "\n");
    assert.equal(run(["config", "validate", workspaceDraftPath, "--config", config]).status, 0);
    outcome = run(["config", "plan", workspaceDraftPath, "--config", config, "--plan", workspacePlanPath, "--json"]);
    assert.equal(outcome.status, 0, outcome.stderr);
    const workspacePlan = JSON.parse(outcome.stdout).plan;
    outcome = run(["apply", "--config", config, "--plan", workspacePlanPath, "--approve", workspacePlan.id, "--json"]);
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.equal(JSON.parse(outcome.stdout).readback.localState.workspaceWorkflowOverlays[0].scope.id, "ws");
    outcome = run(["context", "repo", "--workspace", "ws", "--workflow", "feature", "--config", config, "--json"]);
    assert.equal(outcome.status, 0, outcome.stderr);
    const workspaceContext = JSON.parse(outcome.stdout).context;
    assert.equal(workspaceContext.settings["workspace.setting"], true);
    assert.equal(workspaceContext.settings["workspace.workflow"], true);
    const workspaceWorkflowSetting = workspaceContext.provenance.find((entry: any) => entry.scope.kind === "workspace" && entry.workflowId === "feature");
    const workspaceOrdinarySetting = workspaceContext.provenance.find((entry: any) => entry.scope.kind === "workspace" && entry.workflowId === null);
    assert.ok(workspaceWorkflowSetting && workspaceOrdinarySetting && workspaceContext.provenance.indexOf(workspaceWorkflowSetting) < workspaceContext.provenance.indexOf(workspaceOrdinarySetting));

    const workspaceRefusal = JSON.parse(run(["config", "export", "--target", "workspace", "--workspace", "ws", "--config", config]).stdout);
    workspaceRefusal.document.workspacePolicyOverlays[0].instructions.push({ id: "required", remove: true });
    const workspaceRefusalPath = join(dirs.drafts, "workspace-refusal.json");
    await writeFile(workspaceRefusalPath, JSON.stringify(workspaceRefusal, null, 2) + "\n");
    const stateBeforeWorkspaceRefusal = await readFile(state);
    outcome = run(["config", "validate", workspaceRefusalPath, "--config", config, "--json"]);
    assert.equal(outcome.status, 2);
    assert.equal(JSON.parse(outcome.stderr).error.code, "POLICY_CONFLICT");
    assert.deepEqual(await readFile(state), stateBeforeWorkspaceRefusal);

    outcome = run(["context", "repo", "--config", config, "--workflow", "feature", "--source", sourcePath, "--json"]);
    assert.equal(outcome.status, 0, outcome.stderr);
    const context = JSON.parse(outcome.stdout);
    assert.equal(context.context.settings["commands.test"], "npm run verify");
    assert.deepEqual(context.context.instructions.map((entry: any) => entry.id), ["required", "repository"]);
    assert.ok(context.context.recordProvenance.some((entry: any) => entry.recordId === "optional" && entry.operation === "remove"));
    assert.equal(context.context.workflow.steps[0].configuration.argv[2], "verify");
    assert.deepEqual(context.context.workflow.provenance.map((entry: any) => entry.operation), ["add", "replace"]);
    assert.equal(context.externalComparisons[0].status, "matching");
    outcome = run(["context", "repo", "--config", config, "--workflow", "feature", "--source", sourcePath]);
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.match(outcome.stdout, /setting operations/i);
    assert.match(outcome.stdout, /constraints/i);
    assert.match(outcome.stdout, /named records/i);
    assert.match(outcome.stdout, /workflow steps/i);
    assert.match(outcome.stdout, /external comparisons/i);
    assert.match(outcome.stdout, /sourceRepository.*synthetic\/source/);
    assert.match(outcome.stdout, /sourcePath.*rules\/shared\.json/);
    assert.match(outcome.stdout, /sourceRevision.*rev-1/);
    assert.match(outcome.stdout, /contentDigest/);
    assert.match(outcome.stdout, /Review changes/);
    assert.match(outcome.stdout, /npm.*run.*verify/);
    const sourceBefore = await readFile(sourcePath);
    await writeFile(sourcePath, "drift\n");
    outcome = run(["explain", "repo", "commands.test", "--config", config, "--workflow", "feature", "--source", sourcePath, "--json"]);
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.equal(JSON.parse(outcome.stdout).externalComparisons[0].status, "drift");
    assert.deepEqual(await readFile(sourcePath), Buffer.from("drift\n"));
    assert.notDeepEqual(await readFile(sourcePath), sourceBefore);

    const refusal = JSON.parse(run(["config", "export", "--target", "catalog", "--config", config]).stdout);
    refusal.document.policies[1].instructions.push({ id: "required", remove: true });
    const refusalDraft = join(dirs.drafts, "refusal.json");
    await writeFile(refusalDraft, JSON.stringify(refusal, null, 2) + "\n");
    const catalogBefore = await readFile(catalog);
    outcome = run(["config", "validate", refusalDraft, "--config", config, "--json"]);
    assert.equal(outcome.status, 2);
    assert.equal(JSON.parse(outcome.stderr).error.code, "POLICY_CONFLICT");
    assert.deepEqual(await readFile(catalog), catalogBefore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
