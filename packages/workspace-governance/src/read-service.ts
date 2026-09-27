import { hostname } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { GovernanceError, requireThat } from "./core.ts";
import { diagnose } from "./doctor.ts";
import { runV2Cli } from "./v2-cli.ts";

export const READ_TOOL_NAMES = Object.freeze([
  "workspace_doctor",
  "workspace_list",
  "workspace_where",
  "workspace_context",
  "workspace_explain",
  "workspace_open",
  "workspace_workflow",
  "workspace_operation",
] as const);
export type ReadToolName = (typeof READ_TOOL_NAMES)[number];
export const MAX_MCP_RESULT_BYTES = 1024 * 1024;
const MAX_VALUE_LENGTH = 4096;
const MAX_ITEMS = 32;

type Input = Record<string, unknown>;
export interface ReadServiceResult {
  body: Record<string, unknown>;
  text: string;
  exitCode: number;
}
export interface ReadService {
  readonly configPath: string;
  readonly capabilities: Readonly<{ mode: "read-only"; plans: false; apply: false }>;
  execute(tool: ReadToolName, input: unknown): Promise<ReadServiceResult>;
}

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
function strings(value: unknown): string[] {
  if (value === undefined) return [];
  requireThat(Array.isArray(value) && value.length <= MAX_ITEMS, "INVALID_CONFIG");
  const result = value.map(item => string(item)!);
  requireThat(new Set(result).size === result.length, "INVALID_CONFIG");
  return result;
}
function flag(args: string[], name: string, value: string | undefined): void {
  if (value !== undefined) args.push(`--${name}`, value);
}
function repeated(args: string[], name: string, values: string[]): void {
  for (const value of values) args.push(`--${name}`, value);
}
function exact(value: unknown, allowed: readonly string[]): string {
  const parsed = string(value)!;
  requireThat(allowed.includes(parsed), "INVALID_CONFIG");
  return parsed;
}
function bounded(result: ReadServiceResult): ReadServiceResult {
  requireThat(Buffer.byteLength(JSON.stringify(result.body), "utf8") <= MAX_MCP_RESULT_BYTES, "INCOMPLETE");
  requireThat(Buffer.byteLength(result.text, "utf8") <= MAX_MCP_RESULT_BYTES, "INCOMPLETE");
  return result;
}

export function createReadService(options: { configPath: string; env?: NodeJS.ProcessEnv }): ReadService {
  requireThat(typeof options?.configPath === "string" && options.configPath.length > 0, "INVALID_CONFIG");
  const configPath = resolve(options.configPath);
  requireThat(isAbsolute(options.configPath) && options.configPath === configPath, "INVALID_CONFIG");
  const env = Object.freeze({ ...(options.env ?? process.env) });
  const capabilities = Object.freeze({ mode: "read-only" as const, plans: false as const, apply: false as const });

  async function cli(args: string[]): Promise<ReadServiceResult> {
    const execution = await runV2Cli([...args, "--config", configPath, "--json"], env);
    requireThat(execution.handled && execution.body !== undefined && execution.text !== undefined, "UNSUPPORTED");
    return bounded({ body: execution.body, text: execution.text, exitCode: execution.exitCode ?? 0 });
  }

  return Object.freeze({
    configPath,
    capabilities,
    async execute(tool: ReadToolName, raw: unknown): Promise<ReadServiceResult> {
      if (!(READ_TOOL_NAMES as readonly string[]).includes(tool)) throw new GovernanceError("UNSUPPORTED");
      if (tool === "workspace_doctor") {
        object(raw, []);
        const diagnosis = await diagnose({ configPath, standalone: true, env });
        const body = {
          ...diagnosis,
          mcp: {
            mode: capabilities.mode,
            capabilities,
            configPath,
            machine: { hostname: hostname(), platform: process.platform, arch: process.arch },
          },
        };
        return bounded({ body, text: JSON.stringify(body) + "\n", exitCode: diagnosis.ready ? 0 : 3 });
      }
      if (tool === "workspace_list") {
        const input = object(raw, ["view", "sources", "roots", "depth", "maxPages"]);
        const view = exact(input.view, ["catalog", "groups", "repositories", "coverage"]);
        if (view !== "coverage") {
          requireThat(input.sources === undefined && input.roots === undefined && input.depth === undefined && input.maxPages === undefined, "INVALID_CONFIG");
          return cli(view === "catalog" ? ["list"] : [view === "groups" ? "group" : "repo", "list"]);
        }
        const args = ["list"];
        const sources = strings(input.sources), roots = strings(input.roots);
        requireThat(sources.length > 0 || roots.length > 0, "INVALID_CONFIG");
        requireThat(input.depth === undefined || roots.length > 0, "INVALID_CONFIG");
        requireThat(input.maxPages === undefined || sources.length > 0, "INVALID_CONFIG");
        repeated(args, "source", sources);
        repeated(args, "root", roots);
        if (input.depth !== undefined) {
          requireThat(Number.isInteger(input.depth) && (input.depth as number) >= 0 && (input.depth as number) <= 32, "INVALID_CONFIG");
          flag(args, "depth", String(input.depth));
        }
        if (input.maxPages !== undefined) {
          requireThat(Number.isInteger(input.maxPages) && (input.maxPages as number) >= 1 && (input.maxPages as number) <= 100, "INVALID_CONFIG");
          flag(args, "max-pages", String(input.maxPages));
        }
        return cli(args);
      }
      if (tool === "workspace_where") {
        const input = object(raw, ["target"]);
        return cli(["where", string(input.target)!]);
      }
      if (tool === "workspace_context" || tool === "workspace_explain") {
        const input = object(raw, ["repository", "field", "workspace", "project", "workflow", "load", "approveContent", "budgetBytes"]);
        const repository = string(input.repository)!;
        const args = [tool === "workspace_context" ? "context" : "explain", repository];
        const field = string(input.field, false);
        requireThat(tool === "workspace_explain" || field === undefined, "INVALID_CONFIG");
        if (field !== undefined) args.push(field);
        flag(args, "workspace", string(input.workspace, false));
        flag(args, "project", string(input.project, false));
        flag(args, "workflow", string(input.workflow, false));
        repeated(args, "load", strings(input.load));
        repeated(args, "approve-content", strings(input.approveContent));
        if (input.budgetBytes !== undefined) {
          requireThat(Number.isInteger(input.budgetBytes) && (input.budgetBytes as number) >= 256 && (input.budgetBytes as number) <= 1024 * 1024, "INVALID_CONFIG");
          flag(args, "budget-bytes", String(input.budgetBytes));
        }
        return cli(args);
      }
      if (tool === "workspace_open") {
        const input = object(raw, ["target", "host"]);
        const args = ["open", string(input.target)!];
        const host = input.host === undefined ? undefined : exact(input.host, ["hermes", "terminal", "codex"]);
        flag(args, "host", host);
        return cli(args);
      }
      if (tool === "workspace_workflow") {
        const input = object(raw, ["action", "repository", "workspace", "coordination", "workflow", "run"]);
        const action = exact(input.action, ["list", "show", "status"]);
        if (action === "status") {
          requireThat(input.repository === undefined && input.workspace === undefined && input.coordination === undefined && input.workflow === undefined, "INVALID_CONFIG");
          return cli(["workflow", "status", "--run", string(input.run)!]);
        }
        requireThat(input.run === undefined, "INVALID_CONFIG");
        const repository = string(input.repository, false);
        const workspace = string(input.workspace, false);
        const coordination = string(input.coordination, false);
        requireThat(coordination === undefined ? repository !== undefined && workspace !== undefined : repository === undefined && workspace === undefined, "INVALID_CONFIG");
        requireThat(action !== "list" || coordination === undefined, "INVALID_CONFIG");
        const args = ["workflow", action];
        flag(args, "repo", repository); flag(args, "workspace", workspace); flag(args, "coordination", coordination);
        if (action === "show") flag(args, "workflow", string(input.workflow)!);
        else requireThat(input.workflow === undefined, "INVALID_CONFIG");
        return cli(args);
      }
      const input = object(raw, ["action", "operation", "repository"]);
      const action = exact(input.action, ["show", "worktrees"]);
      if (action === "show") {
        requireThat(input.repository === undefined, "INVALID_CONFIG");
        return cli(["operation", "show", string(input.operation)!]);
      }
      requireThat(input.operation === undefined, "INVALID_CONFIG");
      return cli(["worktree", "list", "--repo", string(input.repository)!]);
    },
  });
}
