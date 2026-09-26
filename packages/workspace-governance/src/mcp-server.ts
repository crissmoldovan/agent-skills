import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { GovernanceError } from "./core.ts";
import { createGovernanceService, EFFECT_TOOL_NAMES, PLAN_TOOL_NAMES, type GovernanceService, type GovernanceToolName } from "./mcp-service.ts";

const value = z.string().min(1).max(4096).regex(/^(?!--)/);
const values = z.array(value).max(32);
const selectedValues = values.min(1);
const workflowInputs = z.record(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/), value).meta({ maxProperties: 32 });
const binding = { run: value, step: value, attempt: value, digest: value } as const;
const schemas = {
  workspace_doctor: z.strictObject({}),
  workspace_list: z.union([
    z.strictObject({ view: z.enum(["catalog", "groups", "repositories"]) }),
    z.strictObject({ view: z.literal("coverage"), sources: selectedValues, maxPages: z.number().int().min(1).max(100).optional() }),
    z.strictObject({ view: z.literal("coverage"), roots: selectedValues, depth: z.number().int().min(0).max(32).optional() }),
    z.strictObject({ view: z.literal("coverage"), sources: selectedValues, roots: selectedValues, depth: z.number().int().min(0).max(32).optional(), maxPages: z.number().int().min(1).max(100).optional() }),
  ]),
  workspace_where: z.strictObject({ target: value }),
  workspace_context: z.strictObject({ repository: value, workspace: value.optional(), project: value.optional(), workflow: value.optional(), load: values.optional(), approveContent: values.optional(), budgetBytes: z.number().int().min(256).max(1024 * 1024).optional() }),
  workspace_explain: z.strictObject({ repository: value, field: value.optional(), workspace: value.optional(), project: value.optional(), workflow: value.optional(), load: values.optional(), approveContent: values.optional(), budgetBytes: z.number().int().min(256).max(1024 * 1024).optional() }),
  workspace_open: z.strictObject({ target: value, host: z.enum(["hermes", "terminal", "codex"]).optional() }),
  workspace_workflow: z.union([
    z.strictObject({ action: z.literal("list"), repository: value, workspace: value }),
    z.strictObject({ action: z.literal("show"), repository: value, workspace: value, workflow: value }),
    z.strictObject({ action: z.literal("show"), coordination: value, workflow: value }),
    z.strictObject({ action: z.literal("status"), run: value }),
  ]),
  workspace_operation: z.discriminatedUnion("action", [z.strictObject({ action: z.literal("show"), operation: value }), z.strictObject({ action: z.literal("worktrees"), repository: value })]),
  workspace_plan: z.discriminatedUnion("operation", [
    z.strictObject({ operation: z.literal("adopt"), repository: value, path: value }),
    z.strictObject({ operation: z.literal("checkout"), repository: value, destination: value, ref: value.optional() }),
    z.strictObject({ operation: z.literal("select-primary"), repository: value, workspace: value }),
    z.strictObject({ operation: z.literal("move"), workspace: value, destination: value, confirmInactive: z.literal(true) }),
    z.strictObject({ operation: z.literal("worktree-create"), repository: value, base: value, branch: value, path: value }),
    z.strictObject({ operation: z.literal("worktree-remove"), workspace: value, confirmInactive: z.literal(true) }),
    z.strictObject({ operation: z.literal("coordination-create"), group: value, path: value }),
    z.strictObject({ operation: z.literal("catalog-draft"), draft: value }),
    z.strictObject({ operation: z.literal("group-create"), id: value, kind: z.enum(["organization", "area", "project"]), name: value, slug: value, parent: value.optional() }),
    z.strictObject({ operation: z.literal("group-update"), id: value, name: value.optional(), slug: value.optional() })
      .refine(input => input.name !== undefined || input.slug !== undefined)
      .meta({ anyOf: [{ required: ["name"] }, { required: ["slug"] }] }),
    z.strictObject({ operation: z.literal("group-reparent"), id: value, parent: value }),
    z.strictObject({ operation: z.literal("repo-membership"), id: value, project: value, action: z.enum(["add", "remove"]) }),
    z.strictObject({ operation: z.literal("repo-classify"), id: value, decision: z.enum(["accept", "reject"]), group: value.optional() })
      .refine(input => input.decision === "accept" ? input.group !== undefined : input.group === undefined)
      .meta({
        allOf: [
          { if: { properties: { decision: { const: "accept" } }, required: ["decision"] }, then: { required: ["group"] } },
          { if: { properties: { decision: { const: "reject" } }, required: ["decision"] }, then: { not: { required: ["group"] } } },
        ],
      }),
    z.strictObject({ operation: z.literal("operation-reconcile"), id: value }),
  ]),
  workspace_apply_plan: z.strictObject({ plan: z.string().regex(/^mcp-[a-f0-9]{32}$/), approval: value }),
  workspace_workflow_run: z.union([
    z.strictObject({ repository: value, workspace: value, workflow: value, inputs: workflowInputs }),
    z.strictObject({ coordination: value, workflow: value, inputs: workflowInputs }),
  ]),
  workspace_workflow_submit: z.strictObject({ ...binding, outcome: z.enum(["completed", "not-completed", "unknown"]), evidence: values.min(1) }),
  workspace_workflow_approve: z.strictObject(binding),
  workspace_workflow_resume: z.strictObject({ run: value }),
  workspace_workflow_interrupt: z.strictObject(binding),
} as const;

const descriptions: Record<GovernanceToolName, string> = {
  workspace_doctor: "Diagnose the immutable selected configuration, stores, trusted roots, runtime, machine, and MCP capabilities.",
  workspace_list: "List the selected catalog summary, business groups, repositories, or explicit coverage.",
  workspace_where: "Resolve one repository and return registered bindings.",
  workspace_context: "Resolve bounded inherited repository context and provenance.",
  workspace_explain: "Explain bounded inherited context while retaining provenance.",
  workspace_open: "Resolve a location and inert host handoff; never activate a host.",
  workspace_workflow: "List/show workflows or read run status without transitions.",
  workspace_operation: "Show an operation journal or list worktrees without mutation.",
  workspace_plan: "Create one inert typed plan at a private server-generated path; no checkout effect occurs.",
  workspace_apply_plan: "Apply one private plan with its opaque identity and exact approval binding.",
  workspace_workflow_run: "Start one exact repository or coordination workflow run.",
  workspace_workflow_submit: "Submit a result for the exact pending workflow attempt and digest.",
  workspace_workflow_approve: "Record a domain approval transition for the exact pending effect; this is not human identity proof.",
  workspace_workflow_resume: "Resume one existing workflow; approved command steps may execute.",
  workspace_workflow_interrupt: "Record an approved effect as interrupted with unknown outcome; never replay it automatically.",
};
const readTools = ["workspace_doctor", "workspace_list", "workspace_where", "workspace_context", "workspace_explain", "workspace_open", "workspace_workflow", "workspace_operation"] as const;

export function createMcpServer(service: GovernanceService): McpServer {
  const server = new McpServer({ name: "workspace-governance", version: "0.3.0-dev" });
  const names: GovernanceToolName[] = [...readTools];
  if (service.capabilities.plans) names.push(...PLAN_TOOL_NAMES);
  if (service.capabilities.apply) names.push(...EFFECT_TOOL_NAMES);
  for (const name of names) {
    const readOnly = (readTools as readonly string[]).includes(name);
    const planning = name === "workspace_plan";
    const openWorld = name === "workspace_list" || planning || name === "workspace_apply_plan" || name === "workspace_workflow_resume";
    server.registerTool(name, {
      description: descriptions[name], inputSchema: schemas[name] as any,
      annotations: {
        title: descriptions[name].split(";")[0],
        readOnlyHint: readOnly,
        destructiveHint: !readOnly && !planning,
        idempotentHint: readOnly,
        openWorldHint: openWorld,
      },
    }, async (input: unknown) => {
      try {
        const result = await service.execute(name, input), body = result.body;
        return { content: [{ type: "text" as const, text: JSON.stringify(body) }], structuredContent: body, ...(result.exitCode === 0 ? {} : { isError: true as const }) };
      } catch (error) {
        const failure = error instanceof GovernanceError ? error : new GovernanceError("ACTION_FAILED");
        const body = { ok: false, error: { code: failure.code, message: failure.message, ...(failure.details === undefined ? {} : { details: failure.details }) } };
        return { isError: true as const, content: [{ type: "text" as const, text: JSON.stringify(body) }], structuredContent: body };
      }
    });
  }
  return server;
}

export function createConfiguredMcpServer(configPath: string, env: NodeJS.ProcessEnv = process.env): McpServer {
  return createMcpServer(createGovernanceService({ configPath, env }));
}
