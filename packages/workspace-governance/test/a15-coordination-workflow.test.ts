import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../src/core.ts";
import { documentRevision } from "../src/v2-model.ts";

const cli = process.env.WORKSPACECTL_E2E_CLI ?? fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const tempRoot = join(homedir(), "tmp", "workspacectl-a15-tests");
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=A15 Fixture", "-c", "user.email=a15@example.invalid", ...args], { cwd, encoding: "utf8" });
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const step = (id: string, type: string, needs: string[], configuration: Record<string, unknown>, approval: "none" | "explicit" = "none") => ({ id, type, needs, configuration, sideEffect: type === "command" ? "workspace" : "none", approval, retry: { mode: "never", maxAttempts: 1 }, required: true });

async function fixture() {
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(tempRoot, "fixture-"));
  const plans = join(root, "plans"), coordination = join(root, "coordination"), sourcePath = join(root, "external-rules.json");
  const repos = { api: join(root, "api"), web: join(root, "web") };
  await Promise.all([plans, coordination, repos.api, repos.web].map((path) => mkdir(path, { recursive: true, mode: 0o700 })));
  for (const [id, path] of Object.entries(repos)) {
    git(path, "init", "--initial-branch=main"); await writeFile(join(path, "tracked.txt"), `${id}\n`); git(path, "add", "."); git(path, "commit", "-m", "fixture"); git(path, "remote", "add", "origin", `https://github.com/acme/${id}`);
  }
  const source = canonicalJson({ rules: ["new-rule"] }); await writeFile(sourcePath, source);
  await mkdir(join(repos.api, "rules")); await writeFile(join(repos.api, "rules", "shared.json"), canonicalJson({ rules: ["old-rule"] }));
  const commandScript = join(root, "command.mjs");
  await writeFile(commandScript, "import { readFile, writeFile } from 'node:fs/promises';\nconst input = await readFile('agent.json', 'utf8');\nawait writeFile('command.json', JSON.stringify({ repo: process.env.A15_REPO, cwd: process.cwd(), input: JSON.parse(input).repo }) + '\\n');\n");
  const configPath = join(root, "config.json"), catalogPath = join(root, "catalog.json"), statePath = join(root, "state.json");
  const config = { schemaVersion: 2, documentType: "workspacectl/config", catalog: { adapter: "file", path: catalogPath }, localState: { adapter: "file", path: statePath }, plans: { directory: plans }, trustedRoots: [root] };
  const members = [{ repositoryId: "api", workspaceId: "ws-api", path: repos.api }, { repositoryId: "web", workspaceId: "ws-web", path: repos.web }];
  const bindingBase = { id: "coord", kind: "coordination", scope: { kind: "project", id: "project" }, path: coordination, memberRepositoryIds: members.map((m) => m.repositoryId), memberWorkspaceIds: members.map((m) => m.workspaceId), hostProjectId: null, generatedFiles: ["WORKSPACE.md", "members.json"] };
  const binding = { ...bindingBase, revision: `sha256:${sha(canonicalJson(bindingBase))}` };
  await writeFile(join(coordination, "WORKSPACE.md"), "# Project\n"); await writeFile(join(coordination, "members.json"), JSON.stringify({ schemaVersion: 1, workspaceId: "coord", scope: { kind: "project", id: "project" }, members }) + "\n");
  const workflows = [{ id: "delivery", scope: { kind: "project", id: "project" }, inputs: [{ id: "task", required: true }], outputs: [{ id: "api-agent", required: true }, { id: "api-command", required: true }, { id: "web-agent", required: true }, { id: "web-command", required: true }, { id: "rule-distribution", required: true }], settings: {}, operations: [], constraints: [], steps: [
    step("coordination", "coordination.check", [], { coordinationWorkspaceId: "coord", memberWorkspaceIds: ["ws-api", "ws-web"] }),
    step("api-context", "context.resolve", ["coordination"], { repositoryId: "api", workspaceId: "ws-api" }),
    step("api-agent", "agent.task", ["api-context"], { repositoryId: "api", workspaceId: "ws-api", target: "api", objective: "Create api/agent.json", expectedOutputs: [{ id: "api-agent", path: "agent.json" }], verification: [{ type: "json-file", path: "agent.json", fields: { repo: "api" } }] }),
    step("api-command", "command", ["api-agent"], { repositoryId: "api", workspaceId: "ws-api", executable: process.execPath, argv: [commandScript], cwd: "workspace", environment: ["A15_REPO"], timeoutMs: 5000, expectedExit: 0 }, "explicit"),
    step("api-verify", "verify", ["api-command"], { repositoryId: "api", workspaceId: "ws-api", checks: [{ type: "json-file", path: "command.json", fields: { repo: "api", cwd: repos.api, input: "api" }, outputId: "api-command" }] }),
    step("web-context", "context.resolve", ["api-verify"], { repositoryId: "web", workspaceId: "ws-web" }),
    step("web-agent", "agent.task", ["web-context"], { repositoryId: "web", workspaceId: "ws-web", target: "web", objective: "Create web/agent.json", expectedOutputs: [{ id: "web-agent", path: "agent.json" }], verification: [{ type: "json-file", path: "agent.json", fields: { repo: "web" } }] }),
    step("web-command", "command", ["web-agent"], { repositoryId: "web", workspaceId: "ws-web", executable: process.execPath, argv: [commandScript], cwd: "workspace", environment: ["A15_REPO"], timeoutMs: 5000, expectedExit: 0 }, "explicit"),
    step("web-verify", "verify", ["web-command"], { repositoryId: "web", workspaceId: "ws-web", checks: [{ type: "json-file", path: "command.json", fields: { repo: "web", cwd: repos.web, input: "web" }, outputId: "web-command" }] }),
    step("rules", "rules.distribute", ["web-verify"], { outputId: "rule-distribution", source: { repositoryId: "rules-source", path: sourcePath, revision: "rules-r2", contentDigest: sha(source) }, repositories: [{ repositoryId: "api", workspaceId: "ws-api", status: "carrying", carryingPath: "rules/shared.json", reviewTarget: "review://api/rules" }, { repositoryId: "web", workspaceId: "ws-web", status: "not-carrying" }] }),
  ] }];
  const catalog = { schemaVersion: 2, documentType: "workspacectl/catalog", groups: [{ id: "org", kind: "organization", name: "Org", slug: "org", parentId: null, metadata: {} }, { id: "project", kind: "project", name: "Project", slug: "project", parentId: "org", metadata: {} }], repositories: Object.entries(repos).map(([id]) => ({ id, remote: `https://github.com/acme/${id}`, sourceId: null, primaryGroupId: "project", memberOf: [], aliases: [], classification: "confirmed", metadata: {} })), sources: [], policies: [{ scope: { kind: "project", id: "project" }, settings: {}, operations: [], constraints: [], instructions: [{ id: "shared", text: "shared-project", required: true }], knowledge: [], skills: [] }, { scope: { kind: "repository", id: "api" }, settings: {}, operations: [], constraints: [], instructions: [{ id: "api-local", text: "api-only", required: true }], knowledge: [], skills: [] }, { scope: { kind: "repository", id: "web" }, settings: {}, operations: [], constraints: [], instructions: [{ id: "web-local", text: "web-only", required: true }], knowledge: [], skills: [] }], workflows, metadata: {} };
  const state = { schemaVersion: 2, documentType: "workspacectl/local-state", selectedConfig: { path: configPath, revision: documentRevision(config) }, repositoryWorkspaces: members.map((m) => ({ id: m.workspaceId, kind: "primary", repositoryId: m.repositoryId, path: m.path, branch: "main", primarySelected: true, hostLinks: {} })), coordinationWorkspaces: [binding], workspacePolicyOverlays: [], workspaceWorkflowOverlays: [], trustedInputApprovals: [], planReferences: [], runReferences: [], metadata: {} };
  await writeFile(configPath, JSON.stringify(config) + "\n"); await writeFile(catalogPath, JSON.stringify(catalog) + "\n"); await writeFile(statePath, JSON.stringify(state) + "\n");
  const run = (args: string[], env: NodeJS.ProcessEnv = process.env) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env });
  return { root, plans, coordination, sourcePath, repos, configPath, catalogPath, statePath, catalog, state, run };
}
const pendingArgs = (run: any) => ["--run", run.id, "--step", run.pending.stepId, "--attempt", run.pending.attemptId, "--digest", run.pending.requestDigest];

async function submitAgent(f: Awaited<ReturnType<typeof fixture>>, run: any) {
  const repo = run.pending.repositoryId; await writeFile(join(f.repos[repo as "api" | "web"], "agent.json"), JSON.stringify({ repo }) + "\n");
  const evidence = join(f.root, `${repo}-evidence.json`); await writeFile(evidence, JSON.stringify({ repo }) + "\n");
  let result = f.run(["workflow", "submit", ...pendingArgs(run), "--outcome", "completed", "--evidence", evidence, "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr);
  result = f.run(["workflow", "resume", "--run", run.id, "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout).run;
}
async function approveCommand(f: Awaited<ReturnType<typeof fixture>>, run: any) {
  let result = f.run(["workflow", "approve", ...pendingArgs(run), "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr);
  result = f.run(["workflow", "resume", "--run", run.id, "--config", f.configPath, "--json"], { ...process.env, A15_REPO: run.pending.repositoryId }); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout).run;
}

test("A15 runs two exact coordination members with isolated contexts and emits repository-local rule proposals only", async () => {
  const f = await fixture();
  try {
    let result = f.run(["workflow", "show", "--coordination", "coord", "--workflow", "delivery", "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr);
    const shown = JSON.parse(result.stdout); assert.equal(shown.coordination.status, "exact"); assert.deepEqual(shown.coordination.members.map((m: any) => m.workspaceId), ["ws-api", "ws-web"]);
    result = f.run(["workflow", "run", "--coordination", "coord", "--workflow", "delivery", "--input", "task=deliver", "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr);
    let run = JSON.parse(result.stdout).run; assert.equal(run.pending.repositoryId, "api"); assert.equal(run.pending.workspaceId, "ws-api"); assert.equal(run.pending.workspacePath, f.repos.api);
    assert.deepEqual(run.pending.context.sharedProjectContext.instructions.map((x: any) => x.text), ["shared-project"]);
    assert.deepEqual(run.pending.context.repositoryContext.instructions.map((x: any) => x.text).sort(), ["api-only", "shared-project"]); assert.doesNotMatch(JSON.stringify(run.pending), /web-only/);
    run = await submitAgent(f, run); assert.equal(run.pending.kind, "command"); assert.equal(run.pending.workspacePath, f.repos.api);
    run = await approveCommand(f, run); assert.equal(run.pending.repositoryId, "web"); assert.doesNotMatch(JSON.stringify(run.pending), /api-only/); assert.match(JSON.stringify(run.pending), /web-only/);
    run = await submitAgent(f, run); run = await approveCommand(f, run); assert.equal(run.status, "completed");
    const distribution = run.steps.find((entry: any) => entry.id === "rules").outcome;
    assert.equal(distribution.proposals.length, 1); assert.equal(distribution.proposals[0].kind, "rule-set.proposal"); assert.equal(distribution.proposals[0].repositoryId, "api"); assert.equal(distribution.proposals[0].workspaceId, "ws-api"); assert.equal(distribution.proposals[0].reviewTarget, "review://api/rules"); assert.equal(distribution.proposals[0].sourceRevision, "rules-r2"); assert.match(distribution.proposals[0].carryingCurrentDigest, /^[a-f0-9]{64}$/); assert.match(distribution.proposals[0].proposalDigest, /^[a-f0-9]{64}$/); assert.equal(distribution.proposals[0].status, "proposed"); assert.equal(distribution.proposals[0].merged, false); assert.equal(distribution.proposals[0].applied, false);
    assert.deepEqual(distribution.repositories.find((entry: any) => entry.repositoryId === "web"), { repositoryId: "web", workspaceId: "ws-web", status: "not-carrying" });
    assert.equal(await readFile(join(f.repos.api, "rules", "shared.json"), "utf8"), canonicalJson({ rules: ["old-rule"] }));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A15 treats generated members as authoritative exact readback before workflow run creation", async () => {
  const f = await fixture();
  try {
    const membersPath = join(f.coordination, "members.json");
    const exact = JSON.parse(await readFile(membersPath, "utf8"));
    let result = f.run(["coordination", "open", "--id", "coord", "--config", f.configPath, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).coordination.status, "exact");

    const mutations: Array<[string, unknown | null]> = [
      ["missing-file", null],
      ["empty", { ...exact, members: [] }],
      ["missing-members", { schemaVersion: 1, workspaceId: "coord", scope: exact.scope }],
      ["duplicate", { ...exact, members: [exact.members[0], exact.members[0]] }],
      ["swapped", { ...exact, members: [...exact.members].reverse() }],
      ["stale-path", { ...exact, members: [{ ...exact.members[0], path: join(f.root, "stale") }, exact.members[1]] }],
      ["wrong-identity", { ...exact, members: [{ ...exact.members[0], repositoryId: "web" }, exact.members[1]] }],
      ["malformed-shape", { ...exact, members: "not-an-array" }],
      ["malformed-json", "{not-json"],
    ];
    for (const [name, mutation] of mutations) {
      if (mutation === null) await rm(membersPath);
      else await writeFile(membersPath, typeof mutation === "string" ? mutation : JSON.stringify(mutation) + "\n");
      for (const args of [
        ["coordination", "open", "--id", "coord"],
        ["workflow", "show", "--coordination", "coord", "--workflow", "delivery"],
        ["workflow", "run", "--coordination", "coord", "--workflow", "delivery", "--input", "task=deliver"],
      ]) {
        result = f.run([...args, "--config", f.configPath, "--json"]);
        assert.notEqual(result.status, 0, `${name}: ${args.slice(0, 2).join(" ")} unexpectedly succeeded`);
      }
      await assert.rejects(readFile(join(f.plans, "runs")), name);
      await writeFile(membersPath, JSON.stringify(exact) + "\n");
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A15 refuses swapped members, mixed target context, stale coordination identity, and proposal route cross-talk before effects", async () => {
  for (const mutation of ["swapped", "mixed", "stale", "cross-talk", "cross-talk-substring", "silent-inheritance"] as const) {
    const f = await fixture();
    try {
      const catalog = structuredClone(f.catalog), state = structuredClone(f.state);
      if (mutation === "swapped") catalog.workflows[0].steps[0].configuration.memberWorkspaceIds = ["ws-web", "ws-api"];
      if (mutation === "mixed") catalog.workflows[0].steps[2].configuration.workspaceId = "ws-web";
      if (mutation === "cross-talk") (catalog.workflows[0].steps[9].configuration as any).repositories[0].reviewTarget = "review://web/rules";
      if (mutation === "cross-talk-substring") (catalog.workflows[0].steps[9].configuration as any).repositories[0].reviewTarget = "review://web/api";
      if (mutation === "silent-inheritance") (catalog.workflows[0].steps[9].configuration as any).repositories[1] = { repositoryId: "web", workspaceId: "ws-web", status: "carrying", carryingPath: "rules/shared.json", reviewTarget: "review://web/rules" };
      if (mutation === "stale") state.coordinationWorkspaces[0].path = join(f.root, "other-coordination");
      await writeFile(f.catalogPath, JSON.stringify(catalog) + "\n"); await writeFile(f.statePath, JSON.stringify(state) + "\n");
      const result = f.run(["workflow", "run", "--coordination", "coord", "--workflow", "delivery", "--input", "task=deliver", "--config", f.configPath, "--json"]);
      assert.notEqual(result.status, 0, mutation); await assert.rejects(readFile(join(f.plans, "runs"))); await assert.rejects(readFile(join(f.repos.api, "agent.json"))); await assert.rejects(readFile(join(f.repos.web, "agent.json")));
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});
