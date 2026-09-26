import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { documentRevision } from "../src/v2-model.ts";

const cli = process.env.WORKSPACECTL_E2E_CLI ?? fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const tempRoot = join(homedir(), "tmp", "workspacectl-a14-tests");
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=A14 Fixture", "-c", "user.email=a14@example.invalid", ...args], { cwd, encoding: "utf8" });
const step = (id: string, type: string, needs: string[], configuration: Record<string, unknown>, approval: "none" | "explicit" = "none", retry: "never" | "safe" = "never") => ({
  id, type, needs, configuration, sideEffect: type === "external.action" ? "external" : type === "command" ? "workspace" : "none", approval,
  retry: { mode: retry, maxAttempts: retry === "safe" ? 3 : 1 }, required: true,
});

async function fixture(kind: "retry" | "ambiguous" = "retry") {
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(tempRoot, "fixture-")), plans = join(root, "plans"), workspace = join(root, "workspace");
  await Promise.all([plans, workspace].map((path) => mkdir(path, { recursive: true, mode: 0o700 })));
  git(workspace, "init", "--initial-branch=main"); await writeFile(join(workspace, "tracked.txt"), "fixture\n"); git(workspace, "add", "."); git(workspace, "commit", "-m", "fixture"); git(workspace, "remote", "add", "origin", "https://github.com/acme/repo");
  const commandScript = join(root, "validate.mjs");
  await writeFile(commandScript, "import { appendFile, readFile } from 'node:fs/promises';\nconst value = JSON.parse(await readFile('agent.json', 'utf8'));\nif (value.result !== 'good') { console.error('validation saw: ' + value.result); process.exit(9); }\nawait appendFile('effects.log', 'command-effect\\n');\n");
  const configPath = join(root, "config.json"), catalogPath = join(root, "catalog.json"), statePath = join(root, "state.json");
  const config = { schemaVersion: 2, documentType: "workspacectl/config", catalog: { adapter: "file", path: catalogPath }, localState: { adapter: "file", path: statePath }, plans: { directory: plans }, trustedRoots: [root] };
  const common = [step("context", "context.resolve", [], { repositoryId: "repo", workspaceId: "ws" }), step("workspace", "workspace.check", ["context"], { repositoryId: "repo", workspaceId: "ws" })];
  const steps = kind === "retry" ? [...common,
    step("agent", "agent.task", ["workspace"], { target: "repo", objective: "Create agent.json", expectedOutputs: [{ id: "agent", path: "agent.json" }], verification: [{ type: "json-file", path: "agent.json", fields: { kind: "task" } }] }),
    step("command", "command", ["agent"], { executable: process.execPath, argv: [commandScript], cwd: "workspace", environment: [], timeoutMs: 5000, expectedExit: 0 }, "explicit", "safe"),
    step("verify", "verify", ["command"], { checks: [{ type: "file", path: "effects.log", content: "command-effect\n", outputId: "effect" }] }),
  ] : [...common,
    step("publish", "external.action", ["workspace"], { target: "synthetic-publication", objective: "Publish once", expectedOutputs: [{ id: "publication", path: "publication.json" }], verification: [{ type: "json-file", path: "publication.json", fields: { id: "release-a14" } }] }, "explicit"),
  ];
  const catalog = { schemaVersion: 2, documentType: "workspacectl/catalog", groups: [{ id: "org", kind: "organization", name: "Org", slug: "org", parentId: null, metadata: {} }], repositories: [{ id: "repo", remote: "https://github.com/acme/repo", sourceId: null, primaryGroupId: "org", memberOf: [], aliases: [], classification: "confirmed", metadata: {} }], sources: [], policies: [], workflows: [{ id: "feature", scope: { kind: "organization", id: "org" }, inputs: [{ id: "task", required: true }], outputs: kind === "retry" ? [{ id: "agent", required: true }, { id: "effect", required: true }] : [{ id: "publication", required: true }], settings: {}, operations: [], constraints: [], steps }], metadata: {} };
  const state = { schemaVersion: 2, documentType: "workspacectl/local-state", selectedConfig: { path: configPath, revision: documentRevision(config) }, repositoryWorkspaces: [{ id: "ws", kind: "primary", repositoryId: "repo", path: workspace, branch: "main", primarySelected: true, hostLinks: {} }], coordinationWorkspaces: [], workspacePolicyOverlays: [], workspaceWorkflowOverlays: [], trustedInputApprovals: [], planReferences: [], runReferences: [], metadata: {} };
  await writeFile(configPath, JSON.stringify(config) + "\n"); await writeFile(catalogPath, JSON.stringify(catalog) + "\n"); await writeFile(statePath, JSON.stringify(state) + "\n");
  const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  return { root, plans, workspace, configPath, catalogPath, commandScript, catalog, run };
}
const args = (run: any) => ["--run", run.id, "--step", run.pending.stepId, "--attempt", run.pending.attemptId, "--digest", run.pending.requestDigest];
const runAsync = (argv: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
  const child = spawn(process.execPath, [cli, ...argv], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("close", (status) => resolve({ status, stdout, stderr }));
});

async function submitAgent(f: Awaited<ReturnType<typeof fixture>>, run: any) {
  await writeFile(join(f.workspace, "agent.json"), JSON.stringify({ kind: "task", result: "bad" }) + "\n"); const evidence = join(f.root, "agent-evidence.json"); await writeFile(evidence, "{}\n");
  let result = f.run(["workflow", "submit", ...args(run), "--outcome", "completed", "--evidence", evidence, "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr);
  result = f.run(["workflow", "resume", "--run", run.id, "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout).run;
}

test("A14 persists a real failed command, revalidates changed output, and retries without repeating effects", async () => {
  const f = await fixture();
  try {
    let result = f.run(["workflow", "run", "--repo", "repo", "--workspace", "ws", "--workflow", "feature", "--input", "task=implement", "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr);
    let run = await submitAgent(f, JSON.parse(result.stdout).run); assert.equal(run.pending.kind, "command");
    result = f.run(["workflow", "approve", ...args(run), "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr);
    result = f.run(["workflow", "resume", "--run", run.id, "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr); run = JSON.parse(result.stdout).run;
    assert.equal(run.status, "failed"); assert.equal(run.steps.find((s: any) => s.id === "command").status, "failed");
    assert.equal(run.steps.find((s: any) => s.id === "command").outcome.exit, 9); assert.match(run.steps.find((s: any) => s.id === "command").outcome.stderr, /validation saw: bad/);
    await assert.rejects(readFile(join(f.workspace, "effects.log")));
    const failedAttempt = run.steps.find((s: any) => s.id === "command").attemptId;
    await writeFile(join(f.workspace, "agent.json"), JSON.stringify({ kind: "task", result: "good" }) + "\n");
    result = f.run(["workflow", "resume", "--run", run.id, "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr); run = JSON.parse(result.stdout).run;
    assert.equal(run.status, "waiting-for-approval"); assert.notEqual(run.pending.attemptId, failedAttempt);
    assert.equal(run.steps.find((s: any) => s.id === "agent").outcome.revalidations.at(-1).changed, true);
    const oldApproval = f.run(["workflow", "approve", "--run", run.id, "--step", "command", "--attempt", failedAttempt, "--digest", run.approvals[0], "--config", f.configPath, "--json"]); assert.notEqual(oldApproval.status, 0);
    result = f.run(["workflow", "approve", ...args(run), "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr);
    result = f.run(["workflow", "resume", "--run", run.id, "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr); run = JSON.parse(result.stdout).run;
    assert.equal(run.status, "completed"); assert.equal(await readFile(join(f.workspace, "effects.log"), "utf8"), "command-effect\n");
    assert.equal(run.steps.find((s: any) => s.id === "command").history[0].outcome.exit, 9);
    const outcome = JSON.stringify(run.steps.find((s: any) => s.id === "command").outcome);
    for (let i = 0; i < 2; i++) { result = f.run(["workflow", "resume", "--run", run.id, "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr); run = JSON.parse(result.stdout).run; }
    assert.equal(await readFile(join(f.workspace, "effects.log"), "utf8"), "command-effect\n"); assert.equal(JSON.stringify(run.steps.find((s: any) => s.id === "command").outcome), outcome);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A14 resolves an interrupted non-idempotent effect only through bound inspected evidence", async () => {
  const f = await fixture("ambiguous");
  try {
    let result = f.run(["workflow", "run", "--repo", "repo", "--workspace", "ws", "--workflow", "feature", "--input", "task=publish", "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr); let run = JSON.parse(result.stdout).run;
    result = f.run(["workflow", "approve", ...args(run), "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr);
    result = f.run(["workflow", "interrupt", ...args(run), "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr); run = JSON.parse(result.stdout).run; assert.equal(run.status, "interrupted"); assert.equal(run.steps.find((s: any) => s.id === "publish").status, "ambiguous");
    const evidence = join(f.root, "inspection.json"); await writeFile(evidence, JSON.stringify({ inspected: true }) + "\n");
    result = f.run(["workflow", "submit", ...args(run), "--outcome", "unknown", "--evidence", evidence, "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr); run = JSON.parse(result.stdout).run; assert.equal(run.status, "interrupted");
    result = f.run(["workflow", "resume", "--run", run.id, "--config", f.configPath, "--json"]); assert.notEqual(result.status, 0);
    const old = { ...run.pending };
    result = f.run(["workflow", "submit", ...args(run), "--outcome", "not-completed", "--evidence", evidence, "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr); run = JSON.parse(result.stdout).run;
    assert.equal(run.status, "waiting-for-approval"); assert.notEqual(run.pending.attemptId, old.attemptId);
    result = f.run(["workflow", "approve", "--run", run.id, "--step", old.stepId, "--attempt", old.attemptId, "--digest", old.requestDigest, "--config", f.configPath, "--json"]); assert.notEqual(result.status, 0);
    result = f.run(["workflow", "approve", ...args(run), "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr);
    await writeFile(join(f.workspace, "publication.json"), JSON.stringify({ id: "release-a14" }) + "\n");
    result = f.run(["workflow", "submit", ...args(run), "--outcome", "completed", "--evidence", evidence, "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr);
    result = f.run(["workflow", "resume", "--run", run.id, "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr); run = JSON.parse(result.stdout).run; assert.equal(run.status, "completed");
    assert.deepEqual(run.steps.find((s: any) => s.id === "publish").history.map((entry: any) => entry.resolution), ["unknown", "not-completed"]);
    const completed = JSON.stringify(run.steps.find((s: any) => s.id === "publish").outcome);
    result = f.run(["workflow", "status", "--run", run.id, "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr); assert.equal(JSON.stringify(JSON.parse(result.stdout).run.steps.find((s: any) => s.id === "publish").outcome), completed);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A14 refuses interrupted command completion until its declared effect readback independently matches", async () => {
  const f = await fixture();
  try {
    let result = f.run(["workflow", "run", "--repo", "repo", "--workspace", "ws", "--workflow", "feature", "--input", "task=implement", "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr);
    let run = await submitAgent(f, JSON.parse(result.stdout).run);
    await writeFile(join(f.workspace, "agent.json"), JSON.stringify({ kind: "task", result: "good" }) + "\n");
    result = f.run(["workflow", "approve", ...args(run), "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr);
    result = f.run(["workflow", "interrupt", ...args(run), "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr); run = JSON.parse(result.stdout).run;
    const evidence = join(f.root, "assertion-only.json"); await writeFile(evidence, "{}\n");
    result = f.run(["workflow", "submit", ...args(run), "--outcome", "completed", "--evidence", evidence, "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr); run = JSON.parse(result.stdout).run;
    const runPath = join(f.plans, "runs", `${run.id}.json`), before = await readFile(runPath);
    result = f.run(["workflow", "resume", "--run", run.id, "--config", f.configPath, "--json"]); assert.notEqual(result.status, 0); assert.equal(JSON.parse(result.stderr).error.code, "INCOMPLETE");
    assert.deepEqual(await readFile(runPath), before); await assert.rejects(readFile(join(f.workspace, "effects.log")));
    await writeFile(join(f.workspace, "effects.log"), "command-effect\n");
    result = f.run(["workflow", "resume", "--run", run.id, "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr); run = JSON.parse(result.stdout).run;
    assert.equal(run.status, "completed"); const verified = run.steps.find((s: any) => s.id === "command").outcome.verified;
    assert.equal(verified.length, 1); assert.equal(verified[0].path, "effects.log"); assert.match(verified[0].digest, /^[a-f0-9]{64}$/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A14 gives one concurrent resume exclusive ownership before command effect execution", async () => {
  const f = await fixture();
  try {
    await writeFile(f.commandScript, "import { appendFile, readFile } from 'node:fs/promises';\nconst value = JSON.parse(await readFile('agent.json', 'utf8'));\nif (value.result !== 'good') process.exit(9);\nAtomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);\nawait appendFile('effects.log', 'command-effect\\n');\n");
    let result = f.run(["workflow", "run", "--repo", "repo", "--workspace", "ws", "--workflow", "feature", "--input", "task=implement", "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr);
    let run = await submitAgent(f, JSON.parse(result.stdout).run); await writeFile(join(f.workspace, "agent.json"), JSON.stringify({ kind: "task", result: "good" }) + "\n");
    result = f.run(["workflow", "approve", ...args(run), "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr);
    const resume = ["workflow", "resume", "--run", run.id, "--config", f.configPath, "--json"];
    const contenders = await Promise.all([runAsync(resume), runAsync(resume)]);
    assert.deepEqual(contenders.map((entry) => entry.status).sort(), [0, 5]);
    assert.equal(JSON.parse(contenders.find((entry) => entry.status === 5)!.stderr).error.code, "BUSY");
    assert.equal(await readFile(join(f.workspace, "effects.log"), "utf8"), "command-effect\n");
    result = f.run(["workflow", "status", "--run", run.id, "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).run.status, "completed");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A14 preserves an unknown per-run lock and refuses before command effect execution", async () => {
  const f = await fixture();
  try {
    let result = f.run(["workflow", "run", "--repo", "repo", "--workspace", "ws", "--workflow", "feature", "--input", "task=implement", "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr);
    const run = await submitAgent(f, JSON.parse(result.stdout).run); await writeFile(join(f.workspace, "agent.json"), JSON.stringify({ kind: "task", result: "good" }) + "\n");
    result = f.run(["workflow", "approve", ...args(run), "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr);
    const lockPath = join(f.plans, "runs", `${run.id}.lock`); await writeFile(lockPath, "unknown lock owner\n");
    result = f.run(["workflow", "resume", "--run", run.id, "--config", f.configPath, "--json"]); assert.equal(result.status, 5); assert.equal(JSON.parse(result.stderr).error.code, "BUSY");
    assert.equal(await readFile(lockPath, "utf8"), "unknown lock owner\n"); await assert.rejects(readFile(join(f.workspace, "effects.log")));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A14 status exposes definition drift while old approval, resume, and executable-byte reuse refuse unchanged", async () => {
  const f = await fixture("ambiguous");
  try {
    let result = f.run(["workflow", "run", "--repo", "repo", "--workspace", "ws", "--workflow", "feature", "--input", "task=publish", "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr); const run = JSON.parse(result.stdout).run;
    result = f.run(["workflow", "approve", ...args(run), "--config", f.configPath, "--json"]); assert.equal(result.status, 0, result.stderr);
    const runPath = join(f.plans, "runs", `${run.id}.json`), before = await readFile(runPath);
    const changed = structuredClone(f.catalog); changed.workflows[0]!.steps.at(-1)!.configuration.objective = "Changed definition"; await writeFile(f.catalogPath, JSON.stringify(changed) + "\n");
    result = f.run(["workflow", "status", "--run", run.id, "--config", f.configPath, "--json"]); assert.equal(result.status, 3, result.stderr); const status = JSON.parse(result.stdout).run; assert.equal(status.validity, "stale"); assert.ok(status.blockers.includes("workflow-definition"));
    for (const command of [["workflow", "approve", ...args(run)], ["workflow", "resume", "--run", run.id]]) { result = f.run([...command, "--config", f.configPath, "--json"]); assert.notEqual(result.status, 0); assert.deepEqual(await readFile(runPath), before); }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
