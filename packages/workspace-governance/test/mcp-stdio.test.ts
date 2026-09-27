import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createMcpFixture } from "./mcp-fixture.ts";
import { MAX_MCP_FRAME_BYTES, MAX_MCP_REQUEST_ID_BYTES } from "../src/mcp-transport.ts";

const server = fileURLToPath(new URL("../src/mcp-cli.ts", import.meta.url));
const expectedTools = [
  "workspace_context", "workspace_doctor", "workspace_explain", "workspace_list",
  "workspace_open", "workspace_operation", "workspace_where", "workspace_workflow",
];

async function bounded<T>(promise: Promise<T>, milliseconds = 5000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("timed out")), milliseconds); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test("official v2 client initializes, lists strict read tools, calls real fixture data, and closes", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-mcp-client-"));
  try {
    const fixture = await createMcpFixture(root);
    const before = await fixture.snapshot();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [server, "--config", fixture.configPath],
      env: { PATH: process.env.PATH ?? "" },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", chunk => { stderr += chunk.toString(); });
    const client = new Client(
      { name: "workspace-governance-test", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    try {
      await bounded(client.connect(transport));
      assert.equal(client.getServerVersion()?.name, "workspace-governance");
      assert.equal(client.getNegotiatedProtocolVersion(), "2026-07-28");

    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name).sort(), expectedTools);
    for (const tool of listed.tools) {
      const branches = (tool.inputSchema as any).oneOf ?? (tool.inputSchema as any).anyOf ?? [tool.inputSchema];
      assert.ok(branches.length > 0, tool.name);
      for (const branch of branches) {
        assert.equal(branch.type, "object", tool.name);
        assert.equal(branch.additionalProperties, false, tool.name);
      }
      assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
      assert.equal(tool.annotations?.destructiveHint, false, tool.name);
    }
    const whereSchema = listed.tools.find(tool => tool.name === "workspace_where")!.inputSchema as any;
    assert.equal(whereSchema.properties.target.maxLength, 4096);

    const response = await client.callTool({ name: "workspace_where", arguments: { target: "service" } });
    assert.notEqual(response.isError, true);
    assert.equal((response.structuredContent as any).repository.id, "repo");
    assert.equal(JSON.parse((response.content[0] as { text: string }).text).repository.id, "repo");

    const workflowList = await client.callTool({ name: "workspace_workflow", arguments: { action: "list", repository: "repo", workspace: "ws" } });
    assert.notEqual(workflowList.isError, true);
    assert.deepEqual((workflowList.structuredContent as any).workflows.map((entry: any) => entry.id), ["feature"]);
    const workflowShow = await client.callTool({ name: "workspace_workflow", arguments: { action: "show", repository: "repo", workspace: "ws", workflow: "feature" } });
    assert.notEqual(workflowShow.isError, true);
    assert.equal((workflowShow.structuredContent as any).workflow.executable, true);
    const workflowStatus = await client.callTool({ name: "workspace_workflow", arguments: { action: "status", run: fixture.runId } });
    assert.notEqual(workflowStatus.isError, true);
    assert.equal((workflowStatus.structuredContent as any).run.status, "completed");
    assert.equal((workflowStatus.structuredContent as any).run.validity, "current");

    const incomplete = await client.callTool({ name: "workspace_context", arguments: { repository: "repo", budgetBytes: 256 } });
    assert.equal(incomplete.isError, true);
    assert.equal((incomplete.structuredContent as any).error.code, "INCOMPLETE");
    assert.equal((incomplete.structuredContent as any).error.details.reason, "oversized-context");
    assert.equal((incomplete.structuredContent as any).error.details.budgetBytes, 256);

    const invalid = await client.callTool({ name: "workspace_where", arguments: { target: "repo", config: "/tmp/other" } });
    assert.equal(invalid.isError, true);
    const invalidWorkflow = await client.callTool({ name: "workspace_workflow", arguments: { action: "status" } });
    assert.equal(invalidWorkflow.isError, true);
    const invalidOperation = await client.callTool({ name: "workspace_operation", arguments: { action: "show", repository: "repo" } });
    assert.equal(invalidOperation.isError, true);
    await assert.rejects(() => client.callTool({ name: "workspace_apply_plan", arguments: {} }));
    assert.equal(await fixture.snapshot(), before);

      assert.equal(stderr, "");
    } finally {
      await bounded(client.close());
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("official client sees immutable opt-in planning and effect capabilities", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-mcp-effect-client-"));
  try {
    const fixture = await createMcpFixture(root);
    for (const flags of [["--allow-plans"], ["--allow-apply"]]) {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [server, "--config", fixture.configPath, ...flags],
        env: { PATH: process.env.PATH ?? "" },
        stderr: "pipe",
      });
      const client = new Client({ name: "workspace-governance-effect-test", version: "1.0.0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
      try {
        await bounded(client.connect(transport));
        const tools = await client.listTools();
        const names = tools.tools.map(tool => tool.name);
        assert.equal(names.includes("workspace_plan"), true);
        assert.equal(names.includes("workspace_apply_plan"), flags[0] === "--allow-apply");
        assert.equal(names.includes("workspace_workflow_interrupt"), flags[0] === "--allow-apply");
        const plan = tools.tools.find(tool => tool.name === "workspace_plan")!;
        const planBranches = (plan.inputSchema as any).oneOf ?? (plan.inputSchema as any).anyOf;
        assert.deepEqual(planBranches.map((branch: any) => branch.properties.operation.const).sort(), [
          "adopt", "catalog-draft", "checkout", "coordination-create", "group-create",
          "group-reparent", "group-update", "move", "operation-reconcile", "portable-import", "repo-classify",
          "repo-membership", "select-primary", "worktree-create", "worktree-remove",
        ]);
        assert.equal(plan.annotations?.readOnlyHint, false);
        assert.equal(plan.annotations?.destructiveHint, false);
        assert.equal(plan.annotations?.idempotentHint, false);
        assert.equal(plan.annotations?.openWorldHint, true);
        const resume = tools.tools.find(tool => tool.name === "workspace_workflow_resume");
        if (resume) assert.equal(resume.annotations?.openWorldHint, true);
        for (const tool of tools.tools.filter(entry => !expectedTools.includes(entry.name))) {
          const branches = (tool.inputSchema as any).oneOf ?? (tool.inputSchema as any).anyOf ?? [tool.inputSchema];
          for (const branch of branches) assert.equal(branch.additionalProperties, false, tool.name);
        }
      } finally { await bounded(client.close()); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("actual tools/list schemas enforce coverage dependencies, plan refinements, and workflow input bounds", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-mcp-schema-parity-"));
  try {
    const fixture = await createMcpFixture(root);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [server, "--config", fixture.configPath, "--allow-apply"],
      env: { PATH: process.env.PATH ?? "" },
      stderr: "pipe",
    });
    const client = new Client({ name: "workspace-governance-schema-test", version: "1.0.0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    try {
      await bounded(client.connect(transport));
      const tools = await client.listTools();
      const ajv = new Ajv2020({ strict: true });
      const coverage = ajv.compile(tools.tools.find(tool => tool.name === "workspace_list")!.inputSchema);
      for (const input of [
        { view: "catalog" },
        { view: "groups" },
        { view: "repositories" },
        { view: "coverage", roots: [fixture.repositoryPath], depth: 1 },
        { view: "coverage", sources: ["source"], maxPages: 1 },
        { view: "coverage", roots: [fixture.repositoryPath], sources: ["source"], depth: 1, maxPages: 1 },
      ]) assert.equal(coverage(input), true, JSON.stringify(coverage.errors));
      for (const input of [
        { view: "coverage" },
        { view: "coverage", roots: [] },
        { view: "coverage", sources: [] },
        { view: "coverage", sources: ["source"], depth: 1 },
        { view: "coverage", roots: [fixture.repositoryPath], maxPages: 1 },
      ]) assert.equal(coverage(input), false, JSON.stringify(input));

      const plan = ajv.compile(tools.tools.find(tool => tool.name === "workspace_plan")!.inputSchema);
      for (const input of [
        { operation: "group-update", id: "org", name: "Organization" },
        { operation: "repo-classify", id: "repo", decision: "accept", group: "project" },
        { operation: "repo-classify", id: "repo", decision: "reject" },
      ]) assert.equal(plan(input), true, JSON.stringify(plan.errors));
      for (const input of [
        { operation: "group-update", id: "org" },
        { operation: "repo-classify", id: "repo", decision: "accept" },
        { operation: "repo-classify", id: "repo", decision: "reject", group: "project" },
      ]) assert.equal(plan(input), false, JSON.stringify(input));

      const runSchema = tools.tools.find(tool => tool.name === "workspace_workflow_run")!.inputSchema as any;
      const run = ajv.compile(runSchema);
      const inputs32 = Object.fromEntries(Array.from({ length: 32 }, (_, index) => [`k${index}`, "v"]));
      const base = { repository: "repo", workspace: "ws", workflow: "feature" };
      assert.equal(run({ ...base, inputs: inputs32 }), true, JSON.stringify(run.errors));
      assert.equal(run({ ...base, inputs: { ...inputs32, k32: "v" } }), false);
      assert.equal(run({ ...base, inputs: { "-bad": "v" } }), false);
      for (const branch of runSchema.anyOf ?? runSchema.oneOf) {
        assert.equal(branch.properties.inputs.maxProperties, 32);
        assert.equal(branch.properties.inputs.propertyNames.pattern, "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$");
      }
    } finally { await bounded(client.close()); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("stdio protocol bounds malformed frames, ids, keys, values, and accepts follow-up requests", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-mcp-bounds-"));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const fixture = await createMcpFixture(root);
    child = spawn(process.execPath, [server, "--config", fixture.configPath], {
      stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "" },
    });
    const stdin = child.stdin, stdout = child.stdout;
    assert.ok(stdin && stdout);
    let buffered = Buffer.alloc(0);
    const queued: Array<{ message: any; bytes: number }> = [];
    const waiters: Array<(value: { message: any; bytes: number }) => void> = [];
    stdout.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      for (;;) {
        const newline = buffered.indexOf(0x0a);
        if (newline < 0) break;
        const line = buffered.subarray(0, newline);
        buffered = buffered.subarray(newline + 1);
        const value = { message: JSON.parse(line.toString("utf8")), bytes: line.length + 1 };
        const waiter = waiters.shift();
        if (waiter) waiter(value); else queued.push(value);
      }
    });
    const receive = (label: string) => bounded(new Promise<{ message: any; bytes: number }>(resolve => {
      const value = queued.shift();
      if (value) resolve(value); else waiters.push(resolve);
    })).catch(error => { throw new Error(`${label}: ${error instanceof Error ? error.message : error}`); });
    const send = (message: unknown) => stdin.write(JSON.stringify(message) + "\n");

    stdin.write('{"jsonrpc":"2.0",\n');
    let response = await receive("malformed JSON");
    assert.equal(response.message.error.code, -32700);
    assert.ok(response.bytes <= MAX_MCP_FRAME_BYTES);

    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "bounds", version: "1" } } });
    response = await receive("initialize");
    assert.equal(response.message.id, 1);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });

    send({ jsonrpc: "2.0", id: "i".repeat(MAX_MCP_REQUEST_ID_BYTES + 1), method: "tools/list", params: {} });
    response = await receive("oversized id");
    assert.equal(response.message.id, null);
    assert.equal(response.message.error.code, -32600);

    send({ jsonrpc: "2.0", id: 2, method: 7, params: {} });
    response = await receive("malformed envelope");
    assert.equal(response.message.error.code, -32600);
    assert.ok(response.bytes <= MAX_MCP_FRAME_BYTES);

    stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "workspace_doctor", arguments: { ["k".repeat(MAX_MCP_FRAME_BYTES + 1024)]: true } } }) + "\n");
    response = await receive("oversized key/value frame");
    assert.equal(response.message.id, null);
    assert.equal(response.message.error.code, -32600);
    assert.ok(response.bytes <= MAX_MCP_FRAME_BYTES);

    send({ jsonrpc: "2.0", id: 4, method: "tools/list", params: {} });
    response = await receive("valid follow-up");
    assert.equal(response.message.id, 4);
    assert.ok(Array.isArray(response.message.result.tools));
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child!.once("exit", resolve));
      child.kill("SIGTERM");
      await bounded(exited, 1000).catch(async () => {
        child!.kill("SIGKILL");
        await bounded(exited, 1000);
      });
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("stdio server exits on EOF and SIGTERM without protocol noise", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-mcp-shutdown-"));
  try {
    const fixture = await createMcpFixture(root);
    for (const mode of ["eof", "sigterm"] as const) {
      const child = spawn(process.execPath, [server, "--config", fixture.configPath], {
        stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "" },
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", chunk => { stdout += chunk.toString(); });
      child.stderr.on("data", chunk => { stderr += chunk.toString(); });
      if (mode === "eof") child.stdin.end();
      else setTimeout(() => child.kill("SIGTERM"), 50);
      const result = await bounded(new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code, signal) => resolve({ code, signal }));
      }));
      assert.ok(result.code === 0 || result.signal === "SIGTERM", JSON.stringify(result));
      assert.equal(stdout, "");
      assert.equal(stderr, "");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
