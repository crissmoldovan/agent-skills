import { randomBytes } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { GovernanceError, requireThat } from "./core.ts";
import { readSelectedRegistry } from "./catalog-readback.ts";
import { createReadService, MAX_MCP_RESULT_BYTES, READ_TOOL_NAMES, type ReadServiceResult, type ReadToolName } from "./read-service.ts";
import { runV2Cli } from "./v2-cli.ts";

export const PLAN_TOOL_NAMES = Object.freeze(["workspace_plan"] as const);
export const EFFECT_TOOL_NAMES = Object.freeze([
  "workspace_apply_plan", "workspace_workflow_run", "workspace_workflow_submit",
  "workspace_workflow_approve", "workspace_workflow_resume", "workspace_workflow_interrupt",
] as const);
export type PlanToolName = (typeof PLAN_TOOL_NAMES)[number];
export type EffectToolName = (typeof EFFECT_TOOL_NAMES)[number];
export type GovernanceToolName = ReadToolName | PlanToolName | EffectToolName;
export interface McpCapabilities { readonly mode: "read-only" | "plans" | "effects"; readonly plans: boolean; readonly apply: boolean }
export interface GovernanceService {
  readonly configPath: string;
  readonly capabilities: McpCapabilities;
  execute(tool: GovernanceToolName, input: unknown): Promise<ReadServiceResult>;
}

type Input = Record<string, unknown>;
const MAX_VALUE_LENGTH = 4096;
const MAX_ITEMS = 32;
const MAX_OPERATIONS = 32;

function object(input: unknown, allowed: readonly string[]): Input {
  requireThat(input !== null && typeof input === "object" && !Array.isArray(input), "INVALID_CONFIG");
  const value = input as Input;
  requireThat(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, "INVALID_CONFIG");
  requireThat(Object.keys(value).every(key => allowed.includes(key)), "INVALID_CONFIG");
  return value;
}
function string(value: unknown, required = true): string | undefined {
  if (value === undefined && !required) return undefined;
  requireThat(typeof value === "string" && value.length > 0 && value.length <= MAX_VALUE_LENGTH && !value.startsWith("--") && !value.includes("\0"), "INVALID_CONFIG");
  return value;
}
function exact(value: unknown, allowed: readonly string[]): string {
  const parsed = string(value)!;
  requireThat(allowed.includes(parsed), "INVALID_CONFIG");
  return parsed;
}
function strings(value: unknown): string[] {
  if (value === undefined) return [];
  requireThat(Array.isArray(value) && value.length <= MAX_ITEMS, "INVALID_CONFIG");
  const result = value.map(item => string(item)!);
  requireThat(new Set(result).size === result.length, "INVALID_CONFIG");
  return result;
}
function inputs(value: unknown): Record<string, string> {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_CONFIG");
  const entries = Object.entries(value as Record<string, unknown>);
  requireThat(entries.length <= MAX_ITEMS, "INVALID_CONFIG");
  const result: Record<string, string> = Object.create(null);
  for (const [key, raw] of entries) {
    requireThat(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(key), "INVALID_CONFIG");
    result[key] = string(raw)!;
  }
  return result;
}
function flag(args: string[], name: string, value: string | undefined): void { if (value !== undefined) args.push(`--${name}`, value); }
function repeated(args: string[], name: string, values: string[]): void { for (const value of values) args.push(`--${name}`, value); }

class OperationGate {
  private active = 0;
  private effectTail: Promise<void> = Promise.resolve();
  async run<T>(effect: boolean, operation: () => Promise<T>): Promise<T> {
    requireThat(this.active < MAX_OPERATIONS, "BUSY");
    this.active += 1;
    if (!effect) {
      try { return await operation(); } finally { this.active -= 1; }
    }
    const predecessor = this.effectTail;
    let release!: () => void;
    this.effectTail = new Promise<void>(resolveRelease => { release = resolveRelease; });
    await predecessor;
    try { return await operation(); } finally { release(); this.active -= 1; }
  }
}

export function createGovernanceService(options: { configPath: string; env?: NodeJS.ProcessEnv; allowPlans?: boolean; allowApply?: boolean }): GovernanceService {
  const read = createReadService({ configPath: options.configPath, env: options.env });
  const env = Object.freeze({ ...(options.env ?? process.env) });
  const apply = options.allowApply === true;
  const plans = apply || options.allowPlans === true;
  const capabilities = Object.freeze({ mode: apply ? "effects" as const : plans ? "plans" as const : "read-only" as const, plans, apply });
  const gate = new OperationGate();

  async function cli(args: string[]): Promise<ReadServiceResult> {
    const execution = await runV2Cli([...args, "--config", read.configPath, "--json"], env);
    requireThat(execution.handled && execution.body !== undefined && execution.text !== undefined, "UNSUPPORTED");
    const result = { body: execution.body, text: execution.text, exitCode: execution.exitCode ?? 0 };
    requireThat(Buffer.byteLength(JSON.stringify(result.body), "utf8") <= MAX_MCP_RESULT_BYTES, "INCOMPLETE");
    requireThat(Buffer.byteLength(result.text, "utf8") <= MAX_MCP_RESULT_BYTES, "INCOMPLETE");
    return result;
  }
  async function plansDirectory(): Promise<string> {
    const registry = await readSelectedRegistry(read.configPath);
    const directory = resolve(registry.config.plans.directory);
    requireThat(directory === registry.config.plans.directory, "INVALID_CONFIG");
    const status = await lstat(directory);
    requireThat(status.isDirectory() && !status.isSymbolicLink() && await realpath(directory) === directory, "UNAVAILABLE");
    return directory;
  }
  async function trustedFile(path: string): Promise<string> {
    requireThat(resolve(path) === path, "INVALID_CONFIG");
    const registry = await readSelectedRegistry(read.configPath);
    requireThat(registry.config.trustedRoots.some(root => path === root || path.startsWith(root + sep)), "UNTRUSTED_INPUT");
    const status = await lstat(path);
    requireThat(status.isFile() && !status.isSymbolicLink() && status.size <= 2 * 1024 * 1024 && await realpath(path) === path, "UNTRUSTED_INPUT");
    return path;
  }
  async function createPlan(raw: unknown): Promise<ReadServiceResult> {
    requireThat(plans, "UNSUPPORTED");
    const input = object(raw, ["operation", "repository", "workspace", "path", "destination", "ref", "base", "branch", "coordination", "group", "draft", "id", "kind", "name", "slug", "parent", "project", "action", "decision", "confirmInactive"]);
    const operation = exact(input.operation, ["adopt", "checkout", "select-primary", "move", "worktree-create", "worktree-remove", "coordination-create", "catalog-draft", "group-create", "group-update", "group-reparent", "repo-membership", "repo-classify", "operation-reconcile"]);
    const operationKeys: Record<string, readonly string[]> = {
      adopt: ["operation", "repository", "path"],
      checkout: ["operation", "repository", "destination", "ref"],
      "select-primary": ["operation", "repository", "workspace"],
      move: ["operation", "workspace", "destination", "confirmInactive"],
      "worktree-create": ["operation", "repository", "base", "branch", "path"],
      "worktree-remove": ["operation", "workspace", "confirmInactive"],
      "coordination-create": ["operation", "group", "path"],
      "catalog-draft": ["operation", "draft"],
      "group-create": ["operation", "id", "kind", "name", "slug", "parent"],
      "group-update": ["operation", "id", "name", "slug"],
      "group-reparent": ["operation", "id", "parent"],
      "repo-membership": ["operation", "id", "project", "action"],
      "repo-classify": ["operation", "id", "decision", "group"],
      "operation-reconcile": ["operation", "id"],
    };
    requireThat(Object.keys(input).every(key => operationKeys[operation].includes(key)), "INVALID_CONFIG");
    const handle = `mcp-${randomBytes(16).toString("hex")}`;
    const planPath = join(await plansDirectory(), `${handle}.json`);
    requireThat(dirname(planPath) === await plansDirectory(), "INVALID_CONFIG");
    const args: string[] = [];
    if (operation === "adopt") { args.push("adopt"); flag(args, "repo", string(input.repository)); flag(args, "path", string(input.path)); }
    else if (operation === "checkout") { args.push("checkout"); flag(args, "repo", string(input.repository)); flag(args, "path", string(input.destination)); flag(args, "ref", string(input.ref, false)); }
    else if (operation === "select-primary") { args.push("workspace", "select-primary"); flag(args, "repo", string(input.repository)); flag(args, "workspace", string(input.workspace)); }
    else if (operation === "move") { requireThat(input.confirmInactive === true, "APPROVAL_REQUIRED"); args.push("move", string(input.workspace)!, "--confirm-inactive"); flag(args, "to", string(input.destination)); }
    else if (operation === "worktree-create") { args.push("worktree", "create"); flag(args, "repo", string(input.repository)); flag(args, "base", string(input.base)); flag(args, "branch", string(input.branch)); flag(args, "path", string(input.path)); }
    else if (operation === "worktree-remove") { requireThat(input.confirmInactive === true, "APPROVAL_REQUIRED"); args.push("worktree", "remove", "--confirm-inactive"); flag(args, "workspace", string(input.workspace)); }
    else if (operation === "coordination-create") { args.push("coordination", "create"); flag(args, "group", string(input.group)); flag(args, "path", string(input.path)); }
    else if (operation === "catalog-draft") { args.push("config", "plan", await trustedFile(string(input.draft)!)); }
    else if (operation === "operation-reconcile") args.push("operation", "reconcile", string(input.id)!);
    else if (operation.startsWith("group-")) {
      const action = operation.slice(6); args.push("group", action); flag(args, "id", string(input.id));
      if (action === "create") { flag(args, "kind", exact(input.kind, ["organization", "area", "project"])); flag(args, "name", string(input.name)); flag(args, "slug", string(input.slug)); flag(args, "parent", string(input.parent, false)); }
      else if (action === "update") { flag(args, "name", string(input.name, false)); flag(args, "slug", string(input.slug, false)); }
      else flag(args, "parent", string(input.parent));
    } else {
      const action = operation === "repo-membership" ? "membership" : "classify"; args.push("repo", action); flag(args, "id", string(input.id));
      if (action === "membership") { flag(args, "project", string(input.project)); flag(args, "action", exact(input.action, ["add", "remove"])); }
      else { flag(args, "decision", exact(input.decision, ["accept", "reject"])); flag(args, "group", string(input.group, false)); }
    }
    args.push("--plan", planPath);
    const result = await cli(args);
    const original = result.body as any;
    return { ...result, body: { ok: true, command: "workspace_plan", applied: false, operation, plan: handle, approval: original.plan.id, preview: original.plan }, text: JSON.stringify({ plan: handle, approval: original.plan.id, preview: original.plan }) + "\n" };
  }
  async function applyPlan(raw: unknown): Promise<ReadServiceResult> {
    requireThat(apply, "UNSUPPORTED");
    const input = object(raw, ["plan", "approval"]), handle = string(input.plan)!;
    requireThat(/^mcp-[a-f0-9]{32}$/.test(handle), "INVALID_CONFIG");
    const directory = await plansDirectory(), planPath = join(directory, `${handle}.json`);
    requireThat(dirname(planPath) === directory, "INVALID_CONFIG");
    return cli(["apply", "--plan", planPath, "--approve", string(input.approval)!]);
  }
  async function workflow(tool: EffectToolName, raw: unknown): Promise<ReadServiceResult> {
    requireThat(apply, "UNSUPPORTED");
    if (tool === "workspace_workflow_run") {
      const input = object(raw, ["repository", "workspace", "coordination", "workflow", "inputs"]);
      const repository = string(input.repository, false), workspace = string(input.workspace, false), coordination = string(input.coordination, false);
      requireThat(coordination === undefined ? repository !== undefined && workspace !== undefined : repository === undefined && workspace === undefined, "INVALID_CONFIG");
      const args = ["workflow", "run"]; flag(args, "repo", repository); flag(args, "workspace", workspace); flag(args, "coordination", coordination); flag(args, "workflow", string(input.workflow));
      for (const [key, value] of Object.entries(inputs(input.inputs))) args.push("--input", `${key}=${value}`);
      return cli(args);
    }
    if (tool === "workspace_workflow_resume") {
      const input = object(raw, ["run"]); return cli(["workflow", "resume", "--run", string(input.run)!]);
    }
    const input = object(raw, tool === "workspace_workflow_submit" ? ["run", "step", "attempt", "digest", "outcome", "evidence"] : ["run", "step", "attempt", "digest"]);
    const subcommand = tool.replace("workspace_workflow_", "");
    const args = ["workflow", subcommand, "--run", string(input.run)!, "--step", string(input.step)!, "--attempt", string(input.attempt)!, "--digest", string(input.digest)!];
    if (tool === "workspace_workflow_submit") {
      flag(args, "outcome", exact(input.outcome, ["completed", "not-completed", "unknown"]));
      const evidence = strings(input.evidence); requireThat(evidence.length > 0, "INVALID_CONFIG");
      for (const path of evidence) await trustedFile(path);
      repeated(args, "evidence", evidence);
    }
    return cli(args);
  }

  return Object.freeze({
    configPath: read.configPath,
    capabilities,
    execute(tool: GovernanceToolName, raw: unknown): Promise<ReadServiceResult> {
      const effect = tool === "workspace_apply_plan" || (EFFECT_TOOL_NAMES as readonly string[]).includes(tool);
      return gate.run(effect, async () => {
        if ((READ_TOOL_NAMES as readonly string[]).includes(tool)) {
          const result = await read.execute(tool as ReadToolName, raw);
          if (tool !== "workspace_doctor") return result;
          const body = { ...result.body, mcp: { ...(result.body.mcp as object), mode: capabilities.mode, capabilities } };
          return { ...result, body, text: JSON.stringify(body) + "\n" };
        }
        if (tool === "workspace_plan") return createPlan(raw);
        if (tool === "workspace_apply_plan") return applyPlan(raw);
        if ((EFFECT_TOOL_NAMES as readonly string[]).includes(tool)) return workflow(tool as EffectToolName, raw);
        throw new GovernanceError("UNSUPPORTED");
      });
    },
  });
}
