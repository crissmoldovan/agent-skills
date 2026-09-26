import { lstat, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GovernanceError, requireThat } from "./core.ts";
import { exportCatalogDraft, exportLocalStateDraft, listCatalog, lookupRepository, readSelectedRegistry } from "./catalog-readback.ts";
import { compareCarriedRuleSet } from "./v2-rules.ts";
import { resolveCatalogContext } from "./v2-context.ts";
import { loadRelevantContext, renderRelevantContextText } from "./relevant-context.ts";
import { requireStablePath } from "./path-safety.ts";
import { selectConfigPath } from "./doctor.ts";
import { observeWorkspace } from "./overview-runtime.ts";
import { renderWorkspaceOverview } from "./overview.ts";
import { acknowledgeHostAction, openTarget } from "./open.ts";
import { reopenCoordinationWorkspace } from "./coordination.ts";
import { parseDataText } from "./v2-model.ts";
import { createPortableDocument } from "./portable.ts";
import { createCheckoutPlan, createCheckoutReconcilePlan, showCheckoutOperation } from "./checkout-operations.ts";
import { createMovePlan, createMoveReconcilePlan, showMoveOperation } from "./move-operations.ts";
import { createWorktreePlan, createWorktreeRemovePlan, listWorktrees, showWorktreeOperation } from "./worktree-operations.ts";
import { approveWorkflowRun, interruptWorkflowRun, listExecutableWorkflows, resumeWorkflow, showExecutableCoordinationWorkflow, showExecutableWorkflow, showWorkflowRun, startCoordinationWorkflow, startWorkflow, submitWorkflowResult } from "./workflow-execution.ts";
import {
  applyWorkspacePlan,
  createAdoptPlan,
  createCatalogChangePlan,
  createCatalogOperationPlan,
  createCoordinationWorkspacePlan,
  createWorkspaceChangePlan,
  createImportPlan,
  createInitPlan,
  createPrimarySelectionPlan,
  createPortableImportPlan,
  loadWorkspacePlan,
  saveWorkspacePlan,
  validateConfigDraftFile,
} from "./registry-plans.ts";

export interface V2CliExecution {
  handled: boolean;
  json: boolean;
  exitCode?: number;
  body?: Record<string, unknown>;
  text?: string;
}

interface ParsedFlags {
  values: Record<string, string>;
  repeated: Record<string, string[]>;
  json: boolean;
}

function parseFlags(
  args: string[],
  allowed: readonly string[],
  repeated: readonly string[] = [],
): ParsedFlags {
  const values: Record<string, string> = Object.create(null);
  const lists: Record<string, string[]> = Object.create(null);
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--json") {
      requireThat(!json, "INVALID_CONFIG");
      json = true;
      continue;
    }
    requireThat(
      flag.startsWith("--") && allowed.includes(flag.slice(2)),
      "INVALID_CONFIG",
    );
    const name = flag.slice(2);
    const value = args[++index];
    requireThat(
      typeof value === "string" && value.length > 0 && !value.startsWith("--"),
      "INVALID_CONFIG",
    );
    if (repeated.includes(name)) (lists[name] ??= []).push(value);
    else {
      requireThat(!Object.hasOwn(values, name), "INVALID_CONFIG");
      values[name] = value;
    }
  }
  return { values, repeated: lists, json };
}

function requireFlags(flags: ParsedFlags, names: readonly string[]): void {
  requireThat(
    names.every((name) => Object.hasOwn(flags.values, name)),
    "INVALID_CONFIG",
  );
}

const overviewFlags = ["config", "source", "root", "depth", "max-pages"] as const;
type OverviewCommand = "discover" | "list" | "report" | "audit";

function parseBoundedInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  requireThat(/^(0|[1-9]\d*)$/.test(value), "INVALID_CONFIG");
  const parsed = Number(value);
  requireThat(Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum, "INVALID_CONFIG");
  return parsed;
}

function hasObservationControls(flags: ParsedFlags): boolean {
  return (
    (flags.repeated.source?.length ?? 0) > 0 ||
    (flags.repeated.root?.length ?? 0) > 0 ||
    Object.hasOwn(flags.values, "depth") ||
    Object.hasOwn(flags.values, "max-pages")
  );
}

async function runOverviewCommand(
  command: OverviewCommand,
  flags: ParsedFlags,
  env: NodeJS.ProcessEnv,
): Promise<V2CliExecution> {
  const sourceIds = flags.repeated.source ?? [];
  const roots = flags.repeated.root ?? [];
  requireThat(new Set(sourceIds).size === sourceIds.length, "INVALID_CONFIG");
  requireThat(new Set(roots).size === roots.length, "INVALID_CONFIG");
  requireThat(
    !Object.hasOwn(flags.values, "depth") || roots.length > 0,
    "INVALID_CONFIG",
  );
  requireThat(
    !Object.hasOwn(flags.values, "max-pages") || sourceIds.length > 0,
    "INVALID_CONFIG",
  );
  if (command === "discover") {
    requireFlags(flags, ["config"]);
    requireThat(sourceIds.length + roots.length > 0, "INVALID_CONFIG");
  }
  const depth = parseBoundedInteger(flags.values.depth, 0, 32, 8);
  const maxPages = parseBoundedInteger(flags.values["max-pages"], 1, 100, 100);
  const selected = selectConfigPath(flags.values.config, env);
  const overview = await observeWorkspace(selected.path, {
    sourceIds,
    roots,
    depth,
    maxPages,
  });
  const incomplete = overview.coverage.selected && overview.coverage.status !== "complete";
  const decisionFinding = overview.findings.some((finding) => finding.severity === "decision");
  return {
    handled: true,
    json: flags.json,
    ...(incomplete || (command === "audit" && decisionFinding) ? { exitCode: 3 } : {}),
    body: {
      ok: true,
      command,
      selectedConfig: selected,
      ...overview,
    },
    text: renderWorkspaceOverview(command, overview),
  };
}

export async function runV2Cli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<V2CliExecution> {
  const command = args[0];
  if (command === "portable") {
    requireThat(["export", "import"].includes(args[1]), "UNSUPPORTED");
    if (args[1] === "export") {
      const flags = parseFlags(args.slice(2), ["config", "output"]); requireFlags(flags, ["output"]);
      const selected = selectConfigPath(flags.values.config, env);
      requireThat(flags.values.output === resolve(flags.values.output), "INVALID_CONFIG");
      const registry = await readSelectedRegistry(selected.path);
      const portable = createPortableDocument(registry.catalog);
      await writeFile(flags.values.output, JSON.stringify(portable, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      return { handled: true, json: flags.json, body: { ok: true, command: "portable export", selectedConfig: selected, outputPath: flags.values.output, portable }, text: `Portable export ${portable.digest} saved to ${flags.values.output}.\n` };
    }
    const flags = parseFlags(args.slice(2), ["config", "input", "plan"]); requireFlags(flags, ["input", "plan"]);
    const selected = selectConfigPath(flags.values.config, env);
    const plan = await createPortableImportPlan({ configPath: selected.path, portablePath: flags.values.input });
    await saveWorkspacePlan(flags.values.plan, plan);
    return { handled: true, json: flags.json, body: { ok: true, command: "portable import", applied: false, selectedConfig: selected, planPath: flags.values.plan, plan }, text: `Portable import preview ${plan.id} saved to ${flags.values.plan}.\nNothing was applied. Review it, then run apply with --approve and this exact plan ID.\n` };
  }
  if (command === "workflow") {
    const subcommand = args[1];
    requireThat(["list", "show", "run", "status", "submit", "approve", "interrupt", "resume"].includes(subcommand), "UNSUPPORTED");
    if (["status", "submit", "approve", "interrupt", "resume"].includes(subcommand)) {
      const allowed = subcommand === "status" || subcommand === "resume" ? ["config", "run"] : ["config", "run", "step", "attempt", "digest", "outcome", "evidence"];
      const flags = parseFlags(args.slice(2), allowed, subcommand === "submit" ? ["evidence"] : []); requireFlags(flags, ["run"]);
      const selected = selectConfigPath(flags.values.config, env); let run;
      if (subcommand === "status") run = await showWorkflowRun(selected.path, flags.values.run);
      else if (subcommand === "resume") run = await resumeWorkflow(selected.path, flags.values.run, env);
      else {
        requireFlags(flags, ["step", "attempt", "digest"]);
        const binding = { stepId: flags.values.step, attemptId: flags.values.attempt, requestDigest: flags.values.digest };
        if (subcommand === "approve" || subcommand === "interrupt") { requireThat(flags.values.outcome === undefined && (flags.repeated.evidence?.length ?? 0) === 0, "INVALID_CONFIG"); run = subcommand === "approve" ? await approveWorkflowRun(selected.path, flags.values.run, binding) : await interruptWorkflowRun(selected.path, flags.values.run, binding); }
        else { requireFlags(flags, ["outcome"]); run = await submitWorkflowResult(selected.path, flags.values.run, { ...binding, outcome: flags.values.outcome, evidenceReferences: flags.repeated.evidence ?? [] }); }
      }
      return { handled: true, json: flags.json, ...(subcommand === "status" && run.validity === "stale" ? { exitCode: 3 } : {}), body: { ok: true, command: `workflow ${subcommand}`, selectedConfig: selected, run }, text: `${run.id}: ${run.status}\n` };
    }
    const flags = parseFlags(args.slice(2), ["config", "repo", "workspace", "coordination", "workflow", "input"], ["input"]);
    const coordinated = flags.values.coordination !== undefined;
    requireThat(coordinated ? flags.values.repo === undefined && flags.values.workspace === undefined : flags.values.repo !== undefined && flags.values.workspace !== undefined, "INVALID_CONFIG");
    const selected = selectConfigPath(flags.values.config, env);
    if (subcommand === "list") {
      requireThat(!coordinated, "UNSUPPORTED");
      requireThat(flags.values.workflow === undefined && (flags.repeated.input?.length ?? 0) === 0, "INVALID_CONFIG");
      const result = await listExecutableWorkflows(selected.path, flags.values.repo, flags.values.workspace);
      return { handled: true, json: flags.json, body: { ok: true, command: "workflow list", selectedConfig: selected, ...result }, text: result.workflows.map((entry) => `${entry.id}\n`).join("") };
    }
    requireFlags(flags, ["workflow"]);
    if (subcommand === "show") {
      requireThat((flags.repeated.input?.length ?? 0) === 0, "INVALID_CONFIG");
      const result = coordinated ? await showExecutableCoordinationWorkflow(selected.path, flags.values.coordination, flags.values.workflow) : await showExecutableWorkflow(selected.path, flags.values.repo, flags.values.workspace, flags.values.workflow);
      return { handled: true, json: flags.json, body: { ok: true, command: "workflow show", selectedConfig: selected, ...result }, text: `${result.workflow.id}: ${result.workflow.steps.length} executable steps\n` };
    }
    const inputs: Record<string, string> = Object.create(null);
    for (const pair of flags.repeated.input ?? []) {
      const separator = pair.indexOf("="); requireThat(separator > 0, "INVALID_CONFIG");
      const key = pair.slice(0, separator), value = pair.slice(separator + 1); requireThat(value.length > 0 && !Object.hasOwn(inputs, key), "INVALID_CONFIG"); inputs[key] = value;
    }
    const run = coordinated ? await startCoordinationWorkflow(selected.path, { coordinationWorkspaceId: flags.values.coordination, workflowId: flags.values.workflow, inputs }) : await startWorkflow(selected.path, { repositoryId: flags.values.repo, workspaceId: flags.values.workspace, workflowId: flags.values.workflow, inputs });
    return { handled: true, json: flags.json, body: { ok: true, command: "workflow run", selectedConfig: selected, run }, text: `${run.id}: ${run.status}\n` };
  }
  if (command === "worktree") {
    requireThat(["list", "create", "remove"].includes(args[1]), "UNSUPPORTED");
    if (args[1] === "list") {
      const flags = parseFlags(args.slice(2), ["config", "repo"]); requireFlags(flags, ["repo"]);
      const selected = selectConfigPath(flags.values.config, env);
      const result = await listWorktrees(selected.path, flags.values.repo);
      return { handled: true, json: flags.json, body: { ok: true, command: "worktree list", selectedConfig: selected, ...result }, text: result.worktrees.map((entry) => `${entry.owned ? "owned" : "foreign"}\t${entry.path}\t${entry.branch ?? "detached"}\n`).join("") };
    }
    if (args[1] === "create") {
      const flags = parseFlags(args.slice(2), ["config", "repo", "base", "branch", "path", "plan"]); requireFlags(flags, ["repo", "base", "branch", "path", "plan"]);
      const selected = selectConfigPath(flags.values.config, env);
      const plan = await createWorktreePlan({ configPath: selected.path, repositoryId: flags.values.repo, base: flags.values.base, branch: flags.values.branch, path: flags.values.path });
      await saveWorkspacePlan(flags.values.plan, plan);
      return { handled: true, json: flags.json, body: { ok: true, command: "worktree create", applied: false, selectedConfig: selected, planPath: flags.values.plan, plan }, text: `Worktree creation preview ${plan.id} saved to ${flags.values.plan}.\nNothing was applied.\n` };
    }
    const removalArgs = args.slice(2), confirmInactive = removalArgs.filter((entry) => entry === "--confirm-inactive").length === 1;
    const flags = parseFlags(removalArgs.filter((entry) => entry !== "--confirm-inactive"), ["config", "workspace", "plan"]);
    requireFlags(flags, ["workspace", "plan"]);
    const selected = selectConfigPath(flags.values.config, env);
    const plan = await createWorktreeRemovePlan({ configPath: selected.path, workspaceId: flags.values.workspace, confirmInactive });
    await saveWorkspacePlan(flags.values.plan, plan);
    return { handled: true, json: flags.json, body: { ok: true, command: "worktree remove", applied: false, selectedConfig: selected, planPath: flags.values.plan, plan }, text: `Worktree removal preview ${plan.id} saved to ${flags.values.plan}.\nNothing was applied.\n` };
  }
  if (command === "checkout") {
    const flags = parseFlags(args.slice(1), ["config", "repo", "path", "ref", "plan"]);
    requireFlags(flags, ["repo", "path", "plan"]);
    const selected = selectConfigPath(flags.values.config, env);
    const plan = await createCheckoutPlan({ configPath: selected.path, repositoryId: flags.values.repo, destination: flags.values.path, ...(flags.values.ref === undefined ? {} : { ref: flags.values.ref }) });
    await saveWorkspacePlan(flags.values.plan, plan);
    return { handled: true, json: flags.json, body: { ok: true, command: "checkout", applied: false, selectedConfig: selected, planPath: flags.values.plan, plan }, text: `Checkout preview ${plan.id} saved to ${flags.values.plan}.\nNothing was cloned or applied.\n` };
  }
  if (command === "move") {
    requireThat(typeof args[1] === "string" && !args[1].startsWith("--"), "INVALID_CONFIG");
    const rest = args.slice(2), confirmInactive = rest.filter((entry) => entry === "--confirm-inactive").length === 1;
    const flags = parseFlags(rest.filter((entry) => entry !== "--confirm-inactive"), ["config", "to", "plan"]); requireFlags(flags, ["to", "plan"]);
    requireThat(confirmInactive, "APPROVAL_REQUIRED");
    const selected = selectConfigPath(flags.values.config, env);
    const plan = await createMovePlan({ configPath: selected.path, workspaceId: args[1], destination: flags.values.to, confirmInactive: true });
    await saveWorkspacePlan(flags.values.plan, plan);
    return { handled: true, json: flags.json, body: { ok: true, command: "move", applied: false, selectedConfig: selected, planPath: flags.values.plan, plan }, text: `Move preview ${plan.id} saved to ${flags.values.plan}.\nNothing was moved or applied.\n` };
  }
  if (command === "operation") {
    requireThat(typeof args[2] === "string" && !args[2].startsWith("--"), "INVALID_CONFIG");
    if (args[1] === "show") {
      const flags = parseFlags(args.slice(3), ["config"]);
      const selected = selectConfigPath(flags.values.config, env);
      let shown;
      try {
        shown = await showWorktreeOperation(selected.path, args[2]);
      } catch (error) {
        if (!(error instanceof GovernanceError) || error.code !== "INVALID_CONFIG") throw error;
        try { shown = await showCheckoutOperation(selected.path, args[2]); }
        catch (checkoutError) {
          if (!(checkoutError instanceof GovernanceError) || checkoutError.code !== "INVALID_CONFIG") throw checkoutError;
          shown = await showMoveOperation(selected.path, args[2]);
        }
      }
      return { handled: true, json: flags.json, ...(shown.operation.status === "needs-attention" ? { exitCode: 3 } : {}), body: { ok: true, command: "operation show", selectedConfig: selected, ...shown }, text: `${shown.operation.id}: ${shown.operation.status}\n${shown.operation.outcome ?? shown.operation.observation.reason}\n` };
    }
    requireThat(args[1] === "reconcile", "UNSUPPORTED");
    const flags = parseFlags(args.slice(3), ["config", "plan"]); requireFlags(flags, ["plan"]);
    const selected = selectConfigPath(flags.values.config, env);
    let plan;
    try { plan = await createCheckoutReconcilePlan(selected.path, args[2]); }
    catch (error) {
      if (!(error instanceof GovernanceError) || error.code !== "INVALID_CONFIG") throw error;
      plan = await createMoveReconcilePlan(selected.path, args[2]);
    }
    await saveWorkspacePlan(flags.values.plan, plan);
    return { handled: true, json: flags.json, body: { ok: true, command: "operation reconcile", applied: false, selectedConfig: selected, planPath: flags.values.plan, plan }, text: `Reconciliation preview ${plan.id} saved to ${flags.values.plan}.\nNothing was applied.\n` };
  }
  if (command === "open") {
    requireThat(typeof args[1] === "string" && !args[1].startsWith("--"), "INVALID_CONFIG");
    const values: Record<string, string> = Object.create(null);
    let activate = false, json = false;
    for (let index = 2; index < args.length; index += 1) {
      const flag = args[index];
      if (flag === "--activate") { requireThat(!activate, "INVALID_CONFIG"); activate = true; continue; }
      if (flag === "--json") { requireThat(!json, "INVALID_CONFIG"); json = true; continue; }
      requireThat(["--config", "--host"].includes(flag) && !Object.hasOwn(values, flag.slice(2)), "INVALID_CONFIG");
      const value = args[++index]; requireThat(typeof value === "string" && value.length > 0 && !value.startsWith("--"), "INVALID_CONFIG"); values[flag.slice(2)] = value;
    }
    const selected = selectConfigPath(values.config, env);
    const opened = await openTarget(selected.path, { target: args[1], ...(values.host === undefined ? {} : { host: values.host as any }), ...(activate ? { activate: true } : {}) });
    return { handled: true, json, body: { ok: true, command: "open", selectedConfig: selected, open: opened }, text: opened.kind === "repository" ? `${opened.logicalTarget.id}: ${opened.path}\n${opened.hostAction === null ? "Read-only; no host action requested.\n" : `Host action ${opened.hostAction.id} (${opened.hostAction.type}) is inert.\n`}` : `${opened.logicalTarget.id}: ${opened.members.length} members${opened.path === null ? "; no coordination workspace" : ` at ${opened.path}`}\n${opened.hostAction === null ? "Read-only; no host action requested.\n" : `Host action ${opened.hostAction.id} (${opened.hostAction.type}) is inert.\n`}` };
  }
  if (command === "host") {
    requireThat(args[1] === "acknowledge", "UNSUPPORTED");
    const flags = parseFlags(args.slice(2), ["config", "action", "readback"]); requireFlags(flags, ["action", "readback"]);
    const selected = selectConfigPath(flags.values.config, env);
    for (const path of [flags.values.action, flags.values.readback]) { requireThat(path === resolve(path), "INVALID_CONFIG"); await requireStablePath(path); const status = await lstat(path); requireThat(status.isFile() && !status.isSymbolicLink() && status.size <= 2 * 1024 * 1024, "INVALID_CONFIG"); }
    const [action, readback] = await Promise.all([flags.values.action, flags.values.readback].map(async (path) => parseDataText(await readFile(path, "utf8"), "json")));
    const result = await acknowledgeHostAction(selected.path, action, readback);
    return { handled: true, json: flags.json, body: { ok: true, command: "host acknowledge", selectedConfig: selected, result }, text: `Verified Hermes Project ${result.project.id} at ${result.project.path}; effective tool cwd ${result.effectiveToolCwd}.\n` };
  }
  if (command === "coordination") {
    if (args[1] === "create") {
      const flags = parseFlags(args.slice(2), ["config", "group", "path", "plan"]); requireFlags(flags, ["group", "path", "plan"]);
      const selected = selectConfigPath(flags.values.config, env);
      const plan = await createCoordinationWorkspacePlan({ configPath: selected.path, groupId: flags.values.group, path: flags.values.path });
      await saveWorkspacePlan(flags.values.plan, plan);
      return { handled: true, json: flags.json, body: { ok: true, command: "coordination create", applied: false, selectedConfig: selected, planPath: flags.values.plan, plan }, text: `Coordination preview ${plan.id} saved to ${flags.values.plan}.\nNothing was applied.\n` };
    }
    requireThat(args[1] === "open", "UNSUPPORTED");
    const flags = parseFlags(args.slice(2), ["config", "id"]); requireFlags(flags, ["id"]);
    const selected = selectConfigPath(flags.values.config, env); const coordination = await reopenCoordinationWorkspace(selected.path, flags.values.id);
    return { handled: true, json: flags.json, ...(coordination.status === "drift" ? { exitCode: 3 } : {}), body: { ok: true, command: "coordination open", selectedConfig: selected, coordination }, text: `${coordination.id}: ${coordination.path} (${coordination.status})\n${coordination.members.map((member) => `  ${member.repositoryId}: ${member.status}${member.path === null ? "" : ` ${member.path}`}`).join("\n")}\n` };
  }
  if (["discover", "report", "audit"].includes(command)) {
    const flags = parseFlags(
      args.slice(1),
      overviewFlags,
      ["source", "root"],
    );
    return runOverviewCommand(command as OverviewCommand, flags, env);
  }
  if (command === "init") {
    const flags = parseFlags(
      args.slice(1),
      ["config", "catalog", "state", "plans-dir", "trusted-root", "plan"],
      ["trusted-root"],
    );
    requireFlags(flags, ["catalog", "state", "plans-dir", "plan"]);
    const trustedRoots = flags.repeated["trusted-root"] ?? [];
    requireThat(trustedRoots.length > 0, "INVALID_CONFIG");
    const selected = selectConfigPath(flags.values.config, env);
    const plan = await createInitPlan({
      configPath: selected.path,
      catalogPath: flags.values.catalog,
      localStatePath: flags.values.state,
      plansDirectory: flags.values["plans-dir"],
      trustedRoots,
    });
    await saveWorkspacePlan(flags.values.plan, plan);
    return {
      handled: true,
      json: flags.json,
      body: {
        ok: true,
        command: "init",
        applied: false,
        selectedConfig: selected,
        planPath: flags.values.plan,
        plan,
      },
      text:
        `Init preview ${plan.id} saved to ${flags.values.plan}.\n` +
        "Nothing was applied. Review it, then run apply with --approve and this exact plan ID.\n",
    };
  }

  if (command === "import-v1") {
    const flags = parseFlags(
      args.slice(1),
      ["config", "manifest", "unclassified", "plan"],
    );
    requireFlags(flags, ["manifest", "unclassified", "plan"]);
    const selected = selectConfigPath(flags.values.config, env);
    const plan = await createImportPlan({
      configPath: selected.path,
      manifestPath: flags.values.manifest,
      unclassifiedPath: flags.values.unclassified,
    });
    await saveWorkspacePlan(flags.values.plan, plan);
    const counts = plan.request.counts as {
      classified: number;
      unclassified: number;
      total: number;
    };
    return {
      handled: true,
      json: flags.json,
      body: {
        ok: true,
        command: "import-v1",
        applied: false,
        selectedConfig: selected,
        planPath: flags.values.plan,
        counts,
        plan,
      },
      text:
        `Import preview ${plan.id} saved to ${flags.values.plan}.\n` +
        `Repositories: ${counts.total}. Nothing was applied.\n` +
        "Review it, then run apply with --approve and this exact plan ID.\n",
    };
  }

  if (command === "apply") {
    const flags = parseFlags(args.slice(1), ["config", "plan", "approve"]);
    requireFlags(flags, ["plan"]);
    const selected = selectConfigPath(flags.values.config, env);
    const plan = await loadWorkspacePlan(flags.values.plan);
    const result = await applyWorkspacePlan(plan, {
      selectedConfigPath: selected.path,
      approval: flags.values.approve,
    });
    const unclassified = result.readback.catalog.repositories.filter(
      (repository) => repository.classification === "unclassified",
    ).length;
    const counts = {
      classified: result.readback.catalog.repositories.length - unclassified,
      unclassified,
      total: result.readback.catalog.repositories.length,
    };
    return {
      handled: true,
      json: flags.json,
      body: {
        ok: true,
        command: "apply",
        applied: true,
        planId: result.planId,
        kind: result.kind,
        counts,
        revisions: result.revisions,
        readback: result.readback,
        ...(result.transition === undefined ? {} : { transition: result.transition }),
      },
      text:
        `Applied ${result.kind} plan ${result.planId}.\n` +
        `Catalog revision: ${result.revisions.catalog}\n` +
        `Local-state revision: ${result.revisions.localState}\n` +
        `Config revision: ${result.revisions.config}\n`,
    };
  }

  if (command === "context" || command === "explain") {
    requireThat(typeof args[1] === "string" && !args[1].startsWith("--"), "INVALID_CONFIG");
    const hasField = command === "explain" && typeof args[2] === "string" && !args[2].startsWith("--");
    const field = hasField ? args[2] : undefined;
    const flags = parseFlags(
      args.slice(hasField ? 3 : 2),
      ["config", "workspace", "project", "workflow", "source", "load", "approve-content", "budget-bytes"],
      ["load", "approve-content"],
    );
    const selected = selectConfigPath(flags.values.config, env);
    const registry = await readSelectedRegistry(selected.path);
    const resolved = resolveCatalogContext(registry.catalog, registry.localState, {
      repositoryId: args[1],
      ...(flags.values.workspace === undefined ? {} : { workspaceId: flags.values.workspace }),
      ...(flags.values.project === undefined ? {} : { selectedProjectId: flags.values.project }),
      ...(flags.values.workflow === undefined ? {} : { workflowId: flags.values.workflow }),
    });
    resolved.revisions = { catalog: registry.revisions.catalog, localState: registry.revisions.localState };
    const context = await loadRelevantContext(resolved, {
      catalogPath: registry.config.catalog.path,
      trustedRoots: registry.config.trustedRoots,
      load: flags.repeated.load ?? [],
      approvals: flags.repeated["approve-content"] ?? [],
      groups: registry.catalog.groups,
      ...(flags.values["budget-bytes"] === undefined ? {} : {
        budgetBytes: parseBoundedInteger(flags.values["budget-bytes"], 1, 16 * 1024 * 1024, 16_000),
      }),
    });
    const comparisons = [];
    if (flags.values.source !== undefined) {
      requireThat(flags.values.source === resolve(flags.values.source), "INVALID_CONFIG");
      await requireStablePath(flags.values.source);
      const status = await lstat(flags.values.source);
      requireThat(status.isFile() && !status.isSymbolicLink() && status.size <= 2 * 1024 * 1024, "INVALID_CONFIG");
      const bytes = await readFile(flags.values.source);
      const provenances = [
        ...context.provenance.flatMap((entry) => entry.provenance ? [entry.provenance] : []),
        ...context.constraints.flatMap((entry) => entry.provenance ? [entry.provenance] : []),
        ...context.instructions.flatMap((entry) => entry.provenance ? [entry.provenance] : []),
        ...context.knowledgeReferences.flatMap((entry) => entry.provenance ? [entry.provenance] : []),
        ...context.selectedSkills.flatMap((entry) => entry.provenance ? [entry.provenance] : []),
        ...(context.workflow?.provenance.flatMap((entry) => entry.provenance ? [entry.provenance] : []) ?? []),
      ].filter((item, index, all) => all.findIndex((candidate) => candidate.contentDigest === item.contentDigest) === index);
      requireThat(provenances.length > 0, "NOT_FOUND");
      const carried = [
        ...registry.catalog.policies,
        ...registry.catalog.workflows,
        ...registry.localState.workspacePolicyOverlays,
        ...(registry.localState.workspaceWorkflowOverlays ?? []),
      ];
      comparisons.push(...provenances.map((provenance) => {
        const payload = carried.find((record) => record.provenance?.contentDigest === provenance.contentDigest);
        requireThat(payload !== undefined, "INVALID_CONFIG");
        return { provenance, ...compareCarriedRuleSet(provenance, payload, bytes) };
      }));
    }
    const bodyContext = field === undefined ? context : {
      ...context,
      settings: Object.hasOwn(context.settings, field) ? { [field]: context.settings[field] } : {},
      provenance: context.provenance.filter((entry) => entry.key === field),
      constraints: context.constraints.filter((entry) => entry.key === field),
    };
    return {
      handled: true,
      json: flags.json,
      body: { ok: true, command, selectedConfig: selected, context: bodyContext, externalComparisons: comparisons },
      text: renderRelevantContextText(context) + (comparisons.length === 0 ? "" : `External comparisons:\n${comparisons.map((entry) => `  ${JSON.stringify(entry)}`).join("\n")}\n`),
    };
  }

  if (command === "where") {
    requireThat(typeof args[1] === "string" && !args[1].startsWith("--"), "INVALID_CONFIG");
    const flags = parseFlags(args.slice(2), ["config"]);
    const selected = selectConfigPath(flags.values.config, env);
    const result = await lookupRepository(selected.path, args[1]);
    return {
      handled: true,
      json: flags.json,
      body: { ok: true, command: "where", selectedConfig: selected, ...result },
      text: result.selectedWorkspace === null
        ? `${result.repository.id}: no selected workspace\n`
        : `${result.repository.id}: ${result.selectedWorkspace.path}\n`,
    };
  }

  if (command === "workspace") {
    requireThat(args[1] === "select-primary", "UNSUPPORTED");
    const flags = parseFlags(args.slice(2), ["config", "repo", "workspace", "plan"]);
    requireFlags(flags, ["repo", "workspace", "plan"]);
    const selected = selectConfigPath(flags.values.config, env);
    const plan = await createPrimarySelectionPlan({
      configPath: selected.path,
      repositoryId: flags.values.repo,
      workspaceId: flags.values.workspace,
    });
    await saveWorkspacePlan(flags.values.plan, plan);
    return {
      handled: true,
      json: flags.json,
      body: {
        ok: true,
        command: "workspace select-primary",
        applied: false,
        selectedConfig: selected,
        planPath: flags.values.plan,
        plan,
      },
      text: `Primary selection preview ${plan.id} saved to ${flags.values.plan}.\nNothing was applied.\n`,
    };
  }

  if (command === "adopt") {
    const flags = parseFlags(args.slice(1), ["config", "repo", "path", "plan"]);
    requireFlags(flags, ["repo", "path", "plan"]);
    const selected = selectConfigPath(flags.values.config, env);
    const plan = await createAdoptPlan({
      configPath: selected.path,
      repositoryId: flags.values.repo,
      path: flags.values.path,
    });
    await saveWorkspacePlan(flags.values.plan, plan);
    return {
      handled: true,
      json: flags.json,
      body: {
        ok: true,
        command: "adopt",
        applied: false,
        selectedConfig: selected,
        planPath: flags.values.plan,
        plan,
      },
      text: `Adopt preview ${plan.id} saved to ${flags.values.plan}.\nNothing was applied.\n`,
    };
  }

  if (command === "list") {
    const flags = parseFlags(
      args.slice(1),
      overviewFlags,
      ["source", "root"],
    );
    if (hasObservationControls(flags))
      return runOverviewCommand("list", flags, env);
    const selected = selectConfigPath(flags.values.config, env);
    const result = await listCatalog(selected.path);
    const lines = [
      `Registered repositories: ${result.counts.total} ` +
        `(${result.counts.classified} classified, ${result.counts.unclassified} unclassified)`,
      ...result.repositories.map(
        (repository) =>
          `[${repository.classification}] ${repository.id} ${repository.remote} ` +
          `workspace ${repository.workspaceState}`,
      ),
    ];
    return {
      handled: true,
      json: flags.json,
      body: {
        ok: true,
        command: "list",
        selectedConfig: selected,
        ...result,
      },
      text: lines.join("\n") + "\n",
    };
  }

  if (command === "config") {
    if (args[1] === "validate") {
      requireThat(typeof args[2] === "string" && !args[2].startsWith("--"), "INVALID_CONFIG");
      const flags = parseFlags(args.slice(3), ["config"]);
      const selected = selectConfigPath(flags.values.config, env);
      const draft = await validateConfigDraftFile(args[2], selected.path);
      return {
        handled: true,
        json: flags.json,
        body: { ok: true, command: "config validate", valid: true, draft },
        text: "Catalog draft is valid.\n",
      };
    }
    if (args[1] === "plan") {
      requireThat(typeof args[2] === "string" && !args[2].startsWith("--"), "INVALID_CONFIG");
      const flags = parseFlags(args.slice(3), ["config", "plan"]);
      requireFlags(flags, ["plan"]);
      const selected = selectConfigPath(flags.values.config, env);
      const draft = await validateConfigDraftFile(args[2], selected.path);
      const plan = await (draft.target === "workspace" ? createWorkspaceChangePlan : createCatalogChangePlan)({ configPath: selected.path, draftPath: args[2] });
      await saveWorkspacePlan(flags.values.plan, plan);
      return {
        handled: true,
        json: flags.json,
        body: {
          ok: true,
          command: "config plan",
          applied: false,
          selectedConfig: selected,
          planPath: flags.values.plan,
          plan,
        },
        text: `Catalog edit preview ${plan.id} saved to ${flags.values.plan}.\nNothing was applied.\n`,
      };
    }
    requireThat(args[1] === "export", "UNSUPPORTED");
    const flags = parseFlags(args.slice(2), ["config", "target", "workspace"]);
    requireFlags(flags, ["target"]);
    requireThat(["catalog", "user", "workspace"].includes(flags.values.target), "INVALID_CONFIG");
    const selected = selectConfigPath(flags.values.config, env);
    if (flags.values.target === "workspace") requireFlags(flags, ["workspace"]);
    else requireThat(flags.values.workspace === undefined, "INVALID_CONFIG");
    const draft = flags.values.target === "workspace"
      ? await exportLocalStateDraft(selected.path, flags.values.workspace)
      : await exportCatalogDraft(selected.path, flags.values.target as "catalog" | "user");
    return {
      handled: true,
      json: flags.json,
      body: {
        ok: true,
        command: "config export",
        selectedConfig: selected,
        draft,
      },
      text: JSON.stringify(draft, null, 2) + "\n",
    };
  }

  if (command === "group") {
    const subcommand = args[1];
    requireThat(["list", "show", "create", "update", "reparent"].includes(subcommand), "UNSUPPORTED");
    const allowedFlags = subcommand === "list"
      ? ["config"]
      : subcommand === "show"
        ? ["config", "id"]
        : subcommand === "create"
          ? ["config", "plan", "id", "kind", "name", "slug", "parent"]
          : subcommand === "update"
            ? ["config", "plan", "id", "name", "slug"]
            : ["config", "plan", "id", "parent"];
    const flags = parseFlags(args.slice(2), allowedFlags);
    const selected = selectConfigPath(flags.values.config, env);
    const draft = await exportCatalogDraft(selected.path);
    if (subcommand === "show") {
      requireFlags(flags, ["id"]);
      const group = draft.document.groups.find((candidate) => candidate.id === flags.values.id);
      requireThat(group !== undefined, "NOT_FOUND");
      const repositories = draft.document.repositories.filter(
        (repository) =>
          repository.primaryGroupId === group.id || repository.memberOf.includes(group.id),
      );
      return {
        handled: true,
        json: flags.json,
        body: {
          ok: true,
          command: "group show",
          selectedConfig: selected,
          revision: draft.expectedRevision,
          group,
          repositories,
        },
        text:
          `${group.kind} ${group.id} ${group.name}\n` +
          repositories.map((repository) => `repository ${repository.id} ${repository.remote}`).join("\n") +
          (repositories.length ? "\n" : ""),
      };
    }
    if (subcommand !== "list") {
      requireFlags(flags, ["id", "plan"]);
      let operation;
      if (subcommand === "create") {
        requireFlags(flags, ["kind", "name", "slug"]);
        requireThat(["organization", "area", "project"].includes(flags.values.kind), "INVALID_CONFIG");
        operation = {
          type: "group-create" as const,
          group: {
            id: flags.values.id,
            kind: flags.values.kind as "organization" | "area" | "project",
            name: flags.values.name,
            slug: flags.values.slug,
            parentId: flags.values.parent ?? null,
            metadata: {},
          },
        };
      } else if (subcommand === "update") {
        requireThat(flags.values.name !== undefined || flags.values.slug !== undefined, "INVALID_CONFIG");
        operation = {
          type: "group-update" as const,
          id: flags.values.id,
          ...(flags.values.name === undefined ? {} : { name: flags.values.name }),
          ...(flags.values.slug === undefined ? {} : { slug: flags.values.slug }),
        };
      } else {
        requireFlags(flags, ["parent"]);
        operation = { type: "group-reparent" as const, id: flags.values.id, parentId: flags.values.parent };
      }
      const plan = await createCatalogOperationPlan(selected.path, operation);
      await saveWorkspacePlan(flags.values.plan, plan);
      return {
        handled: true,
        json: flags.json,
        body: {
          ok: true,
          command: `group ${subcommand}`,
          applied: false,
          selectedConfig: selected,
          planPath: flags.values.plan,
          plan,
        },
        text: `Catalog edit preview ${plan.id} saved to ${flags.values.plan}.\nNothing was applied.\n`,
      };
    }
    return {
      handled: true,
      json: flags.json,
      body: {
        ok: true,
        command: "group list",
        selectedConfig: selected,
        revision: draft.expectedRevision,
        groups: draft.document.groups,
      },
      text:
        draft.document.groups.map((group) => `${group.kind} ${group.id} ${group.name}`).join("\n") +
        (draft.document.groups.length ? "\n" : ""),
    };
  }

  if (command === "repo") {
    const subcommand = args[1];
    requireThat(["list", "show", "membership", "classify"].includes(subcommand), "UNSUPPORTED");
    const allowedFlags = subcommand === "list"
      ? ["config"]
      : subcommand === "show"
        ? ["config", "id"]
        : subcommand === "membership"
          ? ["config", "plan", "id", "project", "action"]
          : ["config", "plan", "id", "decision", "group"];
    const flags = parseFlags(args.slice(2), allowedFlags);
    const selected = selectConfigPath(flags.values.config, env);
    const draft = await exportCatalogDraft(selected.path);
    if (subcommand === "show") {
      requireFlags(flags, ["id"]);
      const repository = draft.document.repositories.find((candidate) => candidate.id === flags.values.id);
      requireThat(repository !== undefined, "NOT_FOUND");
      return {
        handled: true,
        json: flags.json,
        body: {
          ok: true,
          command: "repo show",
          selectedConfig: selected,
          revision: draft.expectedRevision,
          repository,
        },
        text: `${repository.classification} ${repository.id} ${repository.remote}\n`,
      };
    }
    if (subcommand !== "list") {
      requireFlags(flags, ["id", "plan"]);
      const operation = subcommand === "membership"
        ? (() => {
            requireFlags(flags, ["project", "action"]);
            requireThat(["add", "remove"].includes(flags.values.action), "INVALID_CONFIG");
            return {
              type: "repo-membership" as const,
              id: flags.values.id,
              projectId: flags.values.project,
              action: flags.values.action as "add" | "remove",
            };
          })()
        : (() => {
            requireFlags(flags, ["decision"]);
            requireThat(["accept", "reject"].includes(flags.values.decision), "INVALID_CONFIG");
            requireThat(
              flags.values.decision === "accept"
                ? typeof flags.values.group === "string"
                : flags.values.group === undefined,
              "INVALID_CONFIG",
            );
            return {
              type: "repo-classify" as const,
              id: flags.values.id,
              decision: flags.values.decision as "accept" | "reject",
              ...(flags.values.group === undefined ? {} : { groupId: flags.values.group }),
            };
          })();
      const plan = await createCatalogOperationPlan(selected.path, operation);
      await saveWorkspacePlan(flags.values.plan, plan);
      return {
        handled: true,
        json: flags.json,
        body: {
          ok: true,
          command: `repo ${subcommand}`,
          applied: false,
          selectedConfig: selected,
          planPath: flags.values.plan,
          plan,
        },
        text: `Catalog edit preview ${plan.id} saved to ${flags.values.plan}.\nNothing was applied.\n`,
      };
    }
    return {
      handled: true,
      json: flags.json,
      body: {
        ok: true,
        command: "repo list",
        selectedConfig: selected,
        revision: draft.expectedRevision,
        repositories: draft.document.repositories,
      },
      text:
        draft.document.repositories
          .map((repository) => `${repository.classification} ${repository.id} ${repository.remote}`)
          .join("\n") + (draft.document.repositories.length ? "\n" : ""),
    };
  }

  return { handled: false, json: args.includes("--json") };
}
