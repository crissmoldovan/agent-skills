import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { documentRevision } from "../src/v2-model.ts";

const cli = process.env.WORKSPACECTL_E2E_CLI ?? fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const tempRoot = join(homedir(), "tmp", "workspacectl-a13-tests");
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=A13 Fixture", "-c", "user.email=a13@example.invalid", ...args], { cwd, encoding: "utf8" });

const step = (id: string, type: string, needs: string[], configuration: Record<string, unknown>, approval: "none" | "explicit" = "none") => ({
  id, type, needs, configuration, sideEffect: type === "external.action" ? "external" : "none", approval,
  retry: { mode: "never", maxAttempts: 1 }, required: true,
});

async function fixture() {
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(tempRoot, "fixture-"));
  const plans = join(root, "plans"), workspace = join(root, "workspace");
  await Promise.all([plans, workspace].map((path) => mkdir(path, { recursive: true, mode: 0o700 })));
  git(workspace, "init", "--initial-branch=main");
  await writeFile(join(workspace, "tracked.txt"), "fixture\n");
  git(workspace, "add", "."); git(workspace, "commit", "-m", "fixture");
  git(workspace, "remote", "add", "origin", "https://github.com/acme/repo");
  const commandScript = join(root, "validate.mjs");
  await writeFile(commandScript, "import { readFile, writeFile } from 'node:fs/promises';\nif ((await readFile('agent.txt', 'utf8')) !== 'agent-ok\\n') process.exit(9);\nawait writeFile('command.txt', process.env.A13_MARKER + '\\n');\n");
  const configPath = join(root, "config.json"), catalogPath = join(root, "catalog.json"), statePath = join(root, "state.json");
  const config = { schemaVersion: 2, documentType: "workspacectl/config", catalog: { adapter: "file", path: catalogPath }, localState: { adapter: "file", path: statePath }, plans: { directory: plans }, trustedRoots: [root] };
  await writeFile(configPath, JSON.stringify(config) + "\n");
  const catalog = {
    schemaVersion: 2, documentType: "workspacectl/catalog",
    groups: [{ id: "org", kind: "organization", name: "Org", slug: "org", parentId: null, metadata: {} }, { id: "project", kind: "project", name: "Project", slug: "project", parentId: "org", metadata: {} }],
    repositories: [{ id: "repo", remote: "https://github.com/acme/repo", sourceId: null, primaryGroupId: "project", memberOf: [], aliases: [], classification: "confirmed", metadata: {} }], sources: [], policies: [],
    workflows: [{ id: "feature", scope: { kind: "organization", id: "org" }, inputs: [{ id: "task", required: true }], outputs: [{ id: "agent-file", required: true }, { id: "command-file", required: true }, { id: "publication", required: true }], settings: {}, operations: [], constraints: [], steps: [
      step("context", "context.resolve", [], { repositoryId: "repo", workspaceId: "ws" }),
      step("workspace", "workspace.check", ["context"], { repositoryId: "repo", workspaceId: "ws" }),
      step("agent", "agent.task", ["workspace"], { target: "repo", objective: "Create agent.txt", expectedOutputs: [{ id: "agent-file", path: "agent.txt" }], verification: [{ type: "file", path: "agent.txt", content: "agent-ok\n" }] }),
      step("command", "command", ["agent"], { executable: process.execPath, argv: [commandScript], cwd: "workspace", environment: ["A13_MARKER"], timeoutMs: 5000, expectedExit: 0 }, "explicit"),
      step("verify", "verify", ["command"], { checks: [{ type: "file", path: "command.txt", content: "command-ok\n", outputId: "command-file" }] }),
      step("publish", "external.action", ["verify"], { target: "synthetic-publication", objective: "Record safe publication readback", expectedOutputs: [{ id: "publication", path: "publication.json" }], verification: [{ type: "json-file", path: "publication.json", fields: { url: "https://example.invalid/releases/a13", id: "release-a13", commit: "1111111111111111111111111111111111111111" } }] }, "explicit"),
    ] }], metadata: {},
  };
  const state = { schemaVersion: 2, documentType: "workspacectl/local-state", selectedConfig: { path: configPath, revision: documentRevision(config) }, repositoryWorkspaces: [{ id: "ws", kind: "primary", repositoryId: "repo", path: workspace, branch: "main", primarySelected: true, hostLinks: {} }], coordinationWorkspaces: [], workspacePolicyOverlays: [], workspaceWorkflowOverlays: [], trustedInputApprovals: [], planReferences: [], runReferences: [], metadata: {} };
  await writeFile(catalogPath, JSON.stringify(catalog) + "\n"); await writeFile(statePath, JSON.stringify(state) + "\n");
  const run = (args: string[], env: NodeJS.ProcessEnv = process.env) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env });
  return { root, plans, workspace, configPath, catalogPath, statePath, commandScript, catalog, state, run };
}

test("A13 lists, shows, and starts an inherited workflow with a complete bound agent handoff", async () => {
  const f = await fixture();
  try {
    let result = f.run(["workflow", "list", "--repo", "repo", "--workspace", "ws", "--config", f.configPath, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).workflows.map((entry: any) => entry.id), ["feature"]);
    result = f.run(["workflow", "show", "--repo", "repo", "--workspace", "ws", "--workflow", "feature", "--config", f.configPath, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).workflow.steps.map((entry: any) => entry.type), ["context.resolve", "workspace.check", "agent.task", "command", "verify", "external.action"]);
    result = f.run(["workflow", "run", "--repo", "repo", "--workspace", "ws", "--workflow", "feature", "--input", "task=implement", "--config", f.configPath, "--json"], { ...process.env, A13_MARKER: "command-ok" });
    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.run.status, "waiting-for-agent");
    assert.deepEqual(Object.keys(body.run.pending).sort(), ["attemptId", "expectedOutputs", "kind", "objective", "requestDigest", "runId", "stepId", "target", "verification"].sort());
    assert.equal(body.run.pending.kind, "agent.task");
    assert.equal(body.run.steps.find((entry: any) => entry.id === "context").status, "completed");
    assert.equal(body.run.steps.find((entry: any) => entry.id === "workspace").status, "completed");
    assert.equal(body.run.steps.find((entry: any) => entry.id === "agent").status, "waiting");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A13 completes only after valid typed external URL, ID, and commit JSON readback", async () => {
  const f = await fixture();
  const env = { ...process.env, A13_MARKER: "command-ok" };
  try {
    let result = f.run(["workflow", "run", "--repo", "repo", "--workspace", "ws", "--workflow", "feature", "--input", "task=implement", "--config", f.configPath, "--json"], env);
    assert.equal(result.status, 0, result.stderr);
    let run = JSON.parse(result.stdout).run;
    const agent = run.pending;
    await writeFile(join(f.workspace, "agent.txt"), "agent-ok\n");
    const agentEvidence = join(f.root, "agent-evidence.json"); await writeFile(agentEvidence, JSON.stringify({ produced: "agent.txt" }) + "\n");
    result = f.run(["workflow", "submit", "--run", run.id, "--step", agent.stepId, "--attempt", agent.attemptId, "--digest", agent.requestDigest, "--outcome", "completed", "--evidence", agentEvidence, "--config", f.configPath, "--json"], env);
    assert.equal(result.status, 0, result.stderr); run = JSON.parse(result.stdout).run;
    assert.equal(run.status, "waiting-for-agent"); assert.equal(run.steps.find((entry: any) => entry.id === "agent").status, "claimed");
    result = f.run(["workflow", "resume", "--run", run.id, "--config", f.configPath, "--json"], env);
    assert.equal(result.status, 0, result.stderr); run = JSON.parse(result.stdout).run;
    assert.equal(run.status, "waiting-for-approval"); assert.equal(run.pending.kind, "command");
    result = f.run(["workflow", "approve", "--run", run.id, "--step", run.pending.stepId, "--attempt", run.pending.attemptId, "--digest", "0".repeat(64), "--config", f.configPath, "--json"], env);
    assert.notEqual(result.status, 0);
    result = f.run(["workflow", "approve", "--run", run.id, "--step", run.pending.stepId, "--attempt", run.pending.attemptId, "--digest", run.pending.requestDigest, "--config", f.configPath, "--json"], env);
    assert.equal(result.status, 0, result.stderr);
    result = f.run(["workflow", "resume", "--run", run.id, "--config", f.configPath, "--json"], env);
    assert.equal(result.status, 0, result.stderr); run = JSON.parse(result.stdout).run;
    assert.equal(await readFile(join(f.workspace, "command.txt"), "utf8"), "command-ok\n");
    assert.equal(run.status, "waiting-for-approval"); assert.equal(run.pending.kind, "external.action");
    const external = run.pending;
    result = f.run(["workflow", "approve", "--run", run.id, "--step", external.stepId, "--attempt", external.attemptId, "--digest", external.requestDigest, "--config", f.configPath, "--json"], env);
    assert.equal(result.status, 0, result.stderr);
    await writeFile(join(f.workspace, "publication.json"), JSON.stringify({ url: "https://example.invalid/releases/a13", id: "release-a13", commit: "1111111111111111111111111111111111111111" }) + "\n");
    const externalEvidence = join(f.root, "external-evidence.json"); await writeFile(externalEvidence, JSON.stringify({ synthetic: true }) + "\n");
    result = f.run(["workflow", "submit", "--run", run.id, "--step", external.stepId, "--attempt", external.attemptId, "--digest", external.requestDigest, "--outcome", "completed", "--evidence", externalEvidence, "--config", f.configPath, "--json"], env);
    assert.equal(result.status, 0, result.stderr);
    result = f.run(["workflow", "resume", "--run", run.id, "--config", f.configPath, "--json"], env);
    assert.equal(result.status, 0, result.stderr); run = JSON.parse(result.stdout).run;
    assert.equal(run.status, "completed"); assert.equal(run.pending, null);
    assert.ok(run.steps.every((entry: any) => entry.status === "completed"));
    result = f.run(["workflow", "status", "--run", run.id, "--config", f.configPath, "--json"], env);
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).run.status, "completed");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A13 refuses stale bindings, missing or unverified evidence, and changed workflow or executable inputs without mutating the run", async () => {
  const f = await fixture(), env = { ...process.env, A13_MARKER: "command-ok" };
  try {
    let result = f.run(["workflow", "run", "--repo", "repo", "--workspace", "ws", "--workflow", "feature", "--input", "task=implement", "--config", f.configPath, "--json"], env);
    assert.equal(result.status, 0, result.stderr); let run = JSON.parse(result.stdout).run, pending = run.pending;
    const runPath = join(f.plans, "runs", `${run.id}.json`), before = await readFile(runPath);
    for (const args of [
      ["workflow", "submit", "--run", run.id, "--step", pending.stepId, "--attempt", pending.attemptId, "--digest", "0".repeat(64), "--outcome", "completed", "--evidence", f.commandScript, "--config", f.configPath, "--json"],
      ["workflow", "submit", "--run", run.id, "--step", pending.stepId, "--attempt", pending.attemptId, "--digest", pending.requestDigest, "--outcome", "completed", "--config", f.configPath, "--json"],
      ["workflow", "approve", "--run", run.id, "--step", pending.stepId, "--attempt", pending.attemptId, "--digest", pending.requestDigest, "--config", f.configPath, "--json"],
    ]) { result = f.run(args, env); assert.notEqual(result.status, 0); assert.deepEqual(await readFile(runPath), before); }
    await writeFile(join(f.workspace, "agent.txt"), "wrong\n");
    result = f.run(["workflow", "submit", "--run", run.id, "--step", pending.stepId, "--attempt", pending.attemptId, "--digest", pending.requestDigest, "--outcome", "completed", "--evidence", f.commandScript, "--config", f.configPath, "--json"], env);
    assert.equal(result.status, 0, result.stderr); const claimed = await readFile(runPath);
    result = f.run(["workflow", "resume", "--run", run.id, "--config", f.configPath, "--json"], env);
    assert.notEqual(result.status, 0); assert.deepEqual(await readFile(runPath), claimed);
    await writeFile(join(f.workspace, "agent.txt"), "agent-ok\n");
    result = f.run(["workflow", "resume", "--run", run.id, "--config", f.configPath, "--json"], env);
    assert.equal(result.status, 0, result.stderr); run = JSON.parse(result.stdout).run; pending = run.pending;
    const commandWaiting = await readFile(runPath), scriptBytes = await readFile(f.commandScript);
    await writeFile(f.commandScript, Buffer.concat([scriptBytes, Buffer.from("// changed\n")]));
    result = f.run(["workflow", "status", "--run", run.id, "--config", f.configPath, "--json"], env);
    assert.notEqual(result.status, 0); assert.deepEqual(await readFile(runPath), commandWaiting); await writeFile(f.commandScript, scriptBytes);
    const catalogBytes = await readFile(f.catalogPath), changedCatalog = JSON.parse(catalogBytes.toString("utf8")); changedCatalog.workflows[0].steps[2].configuration.objective = "edited"; await writeFile(f.catalogPath, JSON.stringify(changedCatalog) + "\n");
    result = f.run(["workflow", "status", "--run", run.id, "--config", f.configPath, "--json"], env);
    assert.notEqual(result.status, 0); assert.deepEqual(await readFile(runPath), commandWaiting); await writeFile(f.catalogPath, catalogBytes);
    const displaced = `${f.workspace}-displaced`; await rename(f.workspace, displaced); await mkdir(f.workspace); git(f.workspace, "init", "--initial-branch=main"); git(f.workspace, "remote", "add", "origin", "https://github.com/acme/repo");
    result = f.run(["workflow", "status", "--run", run.id, "--config", f.configPath, "--json"], env);
    assert.notEqual(result.status, 0); assert.deepEqual(await readFile(runPath), commandWaiting); await rm(f.workspace, { recursive: true }); await rename(displaced, f.workspace);
    result = f.run(["workflow", "approve", "--run", run.id, "--step", pending.stepId, "--attempt", "attempt-" + "0".repeat(24), "--digest", pending.requestDigest, "--config", f.configPath, "--json"], env);
    assert.notEqual(result.status, 0); assert.deepEqual(await readFile(runPath), commandWaiting);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A13 rejects external actions without a typed JSON URL, ID, or commit readback before effects", async () => {
  const f = await fixture();
  try {
    const malformedVerification = [
      [{ type: "file", path: "publication.json", content: "{}\n" }],
      [{ type: "json-file", path: "publication.json", fields: { status: "published" } }],
      [{ type: "json-file", path: "publication.json", fields: { url: "not-a-url" } }],
      [{ type: "json-file", path: "publication.json", fields: { id: 123 } }],
      [{ type: "json-file", path: "publication.json", fields: { commit: "not-a-commit" } }],
      [{ type: "file", path: "publication.json", content: "{}\n" }, { type: "json-file", path: "unrelated.json", fields: { id: "release-a13" } }],
    ];
    for (const verification of malformedVerification) {
      const catalog = structuredClone(f.catalog);
      catalog.workflows[0].steps[5].configuration.verification = verification;
      await writeFile(f.catalogPath, JSON.stringify(catalog) + "\n");
      const shown = f.run(["workflow", "show", "--repo", "repo", "--workspace", "ws", "--workflow", "feature", "--config", f.configPath, "--json"]);
      assert.notEqual(shown.status, 0, `malformed external verification became executable: ${JSON.stringify(verification)}`);
      const started = f.run(["workflow", "run", "--repo", "repo", "--workspace", "ws", "--workflow", "feature", "--input", "task=implement", "--config", f.configPath, "--json"], { ...process.env, A13_MARKER: "command-ok" });
      assert.notEqual(started.status, 0, `malformed external verification created a run: ${JSON.stringify(verification)}`);
      await assert.rejects(readFile(join(f.plans, "runs")));
    }
    for (const fields of [
      { url: "https://example.invalid/releases/a13" },
      { id: "release-a13" },
      { commit: "1111111111111111111111111111111111111111" },
    ]) {
      const catalog = structuredClone(f.catalog);
      catalog.workflows[0].steps[5].configuration.verification = [{ type: "json-file", path: "publication.json", fields }];
      await writeFile(f.catalogPath, JSON.stringify(catalog) + "\n");
      const shown = f.run(["workflow", "show", "--repo", "repo", "--workspace", "ws", "--workflow", "feature", "--config", f.configPath, "--json"]);
      assert.equal(shown.status, 0, shown.stderr);
      assert.equal(JSON.parse(shown.stdout).workflow.executable, true);
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A13 rejects missing inputs and invalid or unsupported executable graphs before creating a run", async () => {
  const f = await fixture();
  try {
    let result = f.run(["workflow", "run", "--repo", "repo", "--workspace", "ws", "--workflow", "feature", "--config", f.configPath, "--json"], { ...process.env, A13_MARKER: "command-ok" });
    assert.notEqual(result.status, 0); await assert.rejects(readFile(join(f.plans, "runs")));
    const unsupported = structuredClone(f.catalog); unsupported.workflows[0].steps[0].type = "shell.eval"; await writeFile(f.catalogPath, JSON.stringify(unsupported) + "\n");
    result = f.run(["workflow", "show", "--repo", "repo", "--workspace", "ws", "--workflow", "feature", "--config", f.configPath, "--json"]); assert.notEqual(result.status, 0);
    const cyclic = structuredClone(f.catalog); cyclic.workflows[0].steps[0].needs = ["publish"]; await writeFile(f.catalogPath, JSON.stringify(cyclic) + "\n");
    result = f.run(["workflow", "show", "--repo", "repo", "--workspace", "ws", "--workflow", "feature", "--config", f.configPath, "--json"]); assert.notEqual(result.status, 0);
    await assert.rejects(readFile(join(f.plans, "runs")));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
