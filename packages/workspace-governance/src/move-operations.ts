import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, readlink, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { canonicalJson, canonicalRemote, digest, GovernanceError, requireThat } from "./core.ts";
import type { Json } from "./core.ts";
import { FileCatalogStore, FileLocalStateStore, writeLocalStateDocument } from "./document-stores.ts";
import { contained } from "./discovery.ts";
import { requireStablePath } from "./path-safety.ts";
import { loadWorkspacesConfig } from "./registry-plans.ts";
import { documentRevision, parseDataText, validateLocalStateDocument, validateWorkspacePlan, workspacePlanSemanticFields } from "./v2-model.ts";
import type { CatalogDocument, LocalStateDocument, WorkspacePlan, WorkspacesConfig } from "./v2-model.ts";

export interface MoveRequest { configPath: string; workspaceId: string; destination: string; confirmInactive: true }
export interface MoveIdentity { remote: string; head: string; branch: string | null; statusDigest: string; device: string }
export interface MoveOperation {
  format: "workspacectl-operation/1"; id: string; kind: "checkout-move"; planId: string; planDigest: string;
  configPath: string; repositoryId: string; workspaceId: string; source: string; destination: string;
  identity: MoveIdentity; status: "planned" | "running" | "completed" | "failed" | "needs-attention";
  outcome: string | null; updatedAt: string;
}
type Loaded = { config: { document: WorkspacesConfig; revision: string }; catalog: { document: CatalogDocument; revision: string }; localState: { document: LocalStateDocument; revision: string } };

function exactKeys(value: unknown, keys: readonly string[]): asserts value is Record<string, any> {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_CONFIG");
  requireThat(keys.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => keys.includes(key)), "INVALID_CONFIG");
}
function identifier(value: unknown): asserts value is string { requireThat(typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\x00-\x1f/\\]/.test(value), "INVALID_CONFIG"); }
function absolutePath(value: unknown): asserts value is string { requireThat(typeof value === "string" && value === resolve(value) && value.length <= 16384, "INVALID_CONFIG"); }

export function validateMoveOperation(input: unknown): MoveOperation {
  exactKeys(input, ["format", "id", "kind", "planId", "planDigest", "configPath", "repositoryId", "workspaceId", "source", "destination", "identity", "status", "outcome", "updatedAt"]);
  requireThat(input.format === "workspacectl-operation/1" && input.kind === "checkout-move", "INVALID_CONFIG");
  requireThat(typeof input.id === "string" && /^operation-[a-f0-9]{24}$/.test(input.id), "INVALID_CONFIG");
  requireThat(typeof input.planId === "string" && /^plan-[a-f0-9]{32}$/.test(input.planId), "INVALID_CONFIG");
  requireThat(typeof input.planDigest === "string" && /^[a-f0-9]{64}$/.test(input.planDigest), "INVALID_CONFIG");
  absolutePath(input.configPath); absolutePath(input.source); absolutePath(input.destination); identifier(input.repositoryId); identifier(input.workspaceId);
  exactKeys(input.identity, ["remote", "head", "branch", "statusDigest", "device"]);
  requireThat(canonicalRemote(input.identity.remote) === input.identity.remote, "INVALID_CONFIG");
  requireThat(typeof input.identity.head === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.identity.head), "INVALID_CONFIG");
  requireThat(input.identity.branch === null || (typeof input.identity.branch === "string" && input.identity.branch.length > 0 && input.identity.branch.length <= 1024), "INVALID_CONFIG");
  requireThat(typeof input.identity.statusDigest === "string" && /^[a-f0-9]{64}$/.test(input.identity.statusDigest), "INVALID_CONFIG");
  requireThat(typeof input.identity.device === "string" && /^\d+$/.test(input.identity.device), "INVALID_CONFIG");
  requireThat(["planned", "running", "completed", "failed", "needs-attention"].includes(input.status), "INVALID_CONFIG");
  requireThat(input.outcome === null || (typeof input.outcome === "string" && input.outcome.length > 0 && input.outcome.length <= 16384), "INVALID_CONFIG");
  requireThat(typeof input.updatedAt === "string" && new Date(input.updatedAt).toISOString() === input.updatedAt, "INVALID_CONFIG");
  return structuredClone(input) as MoveOperation;
}

async function runGit(args: string[], cwd: string, allowFailure = false) {
  return new Promise<{ stdout: string; stderr: string; code: number }>((accept, reject) => {
    const child = spawn("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [], stderr: Buffer[] = []; let bytes = 0;
    const collect = (target: Buffer[]) => (chunk: Buffer) => { bytes += chunk.length; if (bytes <= 2 * 1024 * 1024) target.push(chunk); else child.kill(); };
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr)); child.on("error", () => reject(new GovernanceError("TOOL_FAILURE")));
    child.on("close", (code) => { const result = { stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), code: code ?? 1 }; if (result.code === 0 || allowFailure) accept(result); else reject(new GovernanceError("ACTION_FAILED")); });
  });
}
async function loadRegistry(configPath: string): Promise<Loaded> {
  absolutePath(configPath); const config = await loadWorkspacesConfig(configPath);
  const [catalog, localState] = await Promise.all([new FileCatalogStore(config.document.catalog.path).read(), new FileLocalStateStore(config.document.localState.path).read()]);
  requireThat(catalog.document !== null && catalog.freshness === "current" && localState.document !== null && localState.freshness === "current", "UNTRUSTED_INPUT");
  requireThat(localState.document.selectedConfig.path === configPath && localState.document.selectedConfig.revision === config.revision, "UNTRUSTED_INPUT");
  return { config, catalog: { ...catalog, document: catalog.document }, localState: { ...localState, document: localState.document } };
}
async function absent(path: string, code = "CONFLICT") { await requireStablePath(path, { allowMissing: true }); try { await lstat(path); throw new GovernanceError(code); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
async function hasActiveProcess(path: string): Promise<boolean> {
  if (process.platform !== "linux") return false;
  let entries: string[]; try { entries = await readdir("/proc"); } catch { return false; }
  for (const entry of entries) if (/^\d+$/.test(entry) && Number(entry) !== process.pid) try { if (contained(path, resolve(await readlink(`/proc/${entry}/cwd`)))) return true; } catch {}
  return false;
}
async function requireNoNestedGitRepository(path: string): Promise<void> {
  const pending = [path];
  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); }
    catch { throw new GovernanceError("UNSUPPORTED"); }
    for (const entry of entries) {
      if (entry.name === ".git") {
        if (current !== path) throw new GovernanceError("UNSUPPORTED");
        continue;
      }
      if (entry.isDirectory()) pending.push(join(current, entry.name));
    }
  }
}
async function requireNoRepositoryFilters(path: string): Promise<void> {
  const pattern = "^filter\\..*\\.(clean|process)$";
  const local = await runGit(["config", "--local", "--get-regexp", pattern], path, true);
  requireThat(local.code <= 1, "TOOL_FAILURE");
  requireThat(local.stdout === "", "UNSUPPORTED");
  const worktreeEnabled = await runGit(["config", "--local", "--type=bool", "--get", "extensions.worktreeConfig"], path, true);
  requireThat(worktreeEnabled.code <= 1, "TOOL_FAILURE");
  if (worktreeEnabled.stdout.trim() === "true") {
    const worktree = await runGit(["config", "--worktree", "--get-regexp", pattern], path, true);
    requireThat(worktree.code <= 1, "TOOL_FAILURE");
    requireThat(worktree.stdout === "", "UNSUPPORTED");
  }
}
async function requireNoLinkedWorktreeMetadata(path: string): Promise<void> {
  const listed = await runGit(["worktree", "list", "--porcelain"], path, true);
  requireThat(listed.code === 0, "UNSUPPORTED");
  const paths = listed.stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
  requireThat(paths.length === 1 && resolve(paths[0]) === resolve(path), "UNSUPPORTED");

  const registrations = join(path, ".git", "worktrees");
  try {
    await requireStablePath(registrations, { allowMissing: true, code: "UNSUPPORTED" });
    const status = await lstat(registrations);
    requireThat(status.isDirectory() && !status.isSymbolicLink(), "UNSUPPORTED");
    requireThat((await readdir(registrations)).length === 0, "UNSUPPORTED");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    if (error instanceof GovernanceError) throw error;
    throw new GovernanceError("UNSUPPORTED");
  }
}

async function identity(path: string, requireClean = true): Promise<MoveIdentity> {
  await requireStablePath(path); const s = await lstat(path); requireThat(s.isDirectory() && !s.isSymbolicLink(), "UNSUPPORTED");
  await requireNoNestedGitRepository(path);
  await requireNoRepositoryFilters(path);
  const [inside, gitDir, commonDir, origin, head, symbolic, statusResult, submodules, staged] = await Promise.all([
    runGit(["rev-parse", "--is-inside-work-tree"], path, true), runGit(["rev-parse", "--path-format=absolute", "--git-dir"], path, true),
    runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], path, true), runGit(["config", "--get", "remote.origin.url"], path, true),
    runGit(["rev-parse", "HEAD"], path, true), runGit(["symbolic-ref", "--short", "HEAD"], path, true),
    runGit(["status", "--porcelain=v1", "--untracked-files=all"], path, true), runGit(["submodule", "status", "--recursive"], path, true),
    runGit(["ls-files", "--stage"], path, true),
  ]);
  requireThat(inside.stdout.trim() === "true" && gitDir.code === 0 && commonDir.code === 0, "UNSUPPORTED");
  requireThat(resolve(gitDir.stdout.trim()) === join(path, ".git") && resolve(commonDir.stdout.trim()) === join(path, ".git"), "UNSUPPORTED");
  await requireNoLinkedWorktreeMetadata(path);
  requireThat(submodules.code === 0 && submodules.stdout.trim() === "" && !staged.stdout.split("\n").some((line) => line.startsWith("160000 ")), "UNSUPPORTED");
  requireThat(origin.code === 0 && head.code === 0 && statusResult.code === 0, "CONFLICT");
  if (requireClean) requireThat(statusResult.stdout === "", "CONFLICT");
  const device = String((await stat(path)).dev);
  return { remote: canonicalRemote(origin.stdout.trim()), head: head.stdout.trim(), branch: symbolic.code === 0 ? symbolic.stdout.trim() : null, statusDigest: digest(statusResult.stdout), device };
}
function nextState(loaded: Loaded, workspaceId: string, source: string, destination: string): LocalStateDocument {
  const next = structuredClone(loaded.localState.document); const target = next.repositoryWorkspaces.find((entry) => entry.id === workspaceId);
  requireThat(target !== undefined && target.kind === "primary" && target.path === source, "CONFLICT");
  requireThat(!next.repositoryWorkspaces.some((entry) => entry.id !== workspaceId && entry.path === destination), "CONFLICT");
  target.path = destination; return validateLocalStateDocument(next);
}
function finishPlan(plan: Omit<WorkspacePlan, "id" | "semanticDigest">): WorkspacePlan { const p = { ...plan, id: `plan-${"0".repeat(32)}`, semanticDigest: "0".repeat(64) } as WorkspacePlan; const semanticDigest = digest(workspacePlanSemanticFields(p)); return validateWorkspacePlan({ ...plan, id: `plan-${semanticDigest.slice(0, 32)}`, semanticDigest }); }

async function deriveMovePlan(input: MoveRequest, createdAt: string, checkBusy = true): Promise<WorkspacePlan> {
  exactKeys(input, ["configPath", "workspaceId", "destination", "confirmInactive"]); requireThat(input.confirmInactive === true, "APPROVAL_REQUIRED"); absolutePath(input.destination); identifier(input.workspaceId);
  const loaded = await loadRegistry(input.configPath); const workspace = loaded.localState.document.repositoryWorkspaces.find((entry) => entry.id === input.workspaceId);
  requireThat(workspace !== undefined && workspace.kind === "primary", "NOT_FOUND");
  const repository = loaded.catalog.document.repositories.find((entry) => entry.id === workspace.repositoryId); requireThat(repository !== undefined, "NOT_FOUND");
  const source = workspace.path; requireThat(source !== input.destination, "CONFLICT");
  requireThat(loaded.config.document.trustedRoots.some((root) => contained(root, input.destination)), "INVALID_CONFIG");
  requireThat(!contained(source, input.destination) && !contained(input.destination, source), "UNSUPPORTED");
  await requireStablePath(dirname(input.destination)); await absent(input.destination); if (checkBusy) requireThat(!(await hasActiveProcess(source)), "BUSY");
  const observed = await identity(source); requireThat(observed.remote === canonicalRemote(repository.remote), "CONFLICT");
  requireThat(String((await stat(dirname(input.destination))).dev) === observed.device, "UNSUPPORTED");
  const next = nextState(loaded, input.workspaceId, source, input.destination), nextRevision = documentRevision(next);
  const operationId = `operation-${digest({ workspaceId: input.workspaceId, source, destination: input.destination, identity: observed, revisions: [loaded.config.revision, loaded.catalog.revision, loaded.localState.revision] }).slice(0, 24)}`;
  return finishPlan({ schemaVersion: 2, format: "workspacectl-plan/1", kind: "checkout-move", createdAt,
    inputRevisions: { config: loaded.config.revision, catalog: loaded.catalog.revision, localState: loaded.localState.revision, sources: { checkout: digest(observed), source: digest(source), destination: digest(input.destination) } }, repositoryIds: [workspace.repositoryId],
    request: { configPath: input.configPath, plansDirectory: loaded.config.document.plans.directory, operationId, repositoryId: workspace.repositoryId, workspaceId: input.workspaceId, source, destination: input.destination, confirmInactive: true, identity: observed as unknown as Json, localStateChange: { currentRevision: loaded.localState.revision, nextRevision } },
    actions: [{ id: "rename-checkout", type: "directory-rename", path: input.destination }, { id: "write-local-state", type: "document-cas", target: "local-state", path: loaded.config.document.localState.path, expectedRevision: loaded.localState.revision, nextRevision }],
    preconditions: [{ id: "source-exact", type: "source-digest", target: "checkout", expected: digest(observed) }, { id: "destination-absent", type: "revision", target: "destination", expected: "absent" }],
    expectedOutputs: [{ id: "local-state-edited", type: "document", target: "local-state", revision: nextRevision }], approvalsRequired: [{ id: "apply", kind: "explicit-plan-id" }] });
}
export function createMovePlan(input: MoveRequest, createdAt = new Date().toISOString()) { return deriveMovePlan(input, createdAt); }

function operationPath(plans: string, id: string) { requireThat(/^operation-[a-f0-9]{24}$/.test(id), "INVALID_CONFIG"); return join(plans, "operations", `${id}.json`); }
async function writeOperation(plans: string, operation: MoveOperation) { validateMoveOperation(operation); const dir = join(plans, "operations"); await mkdir(dir, { recursive: true, mode: 0o700 }); await requireStablePath(dir); const temporary = join(dir, `.${operation.id}.${process.pid}.${createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 8)}.tmp`); await writeFile(temporary, JSON.stringify(operation, null, 2) + "\n", { mode: 0o600, flag: "wx" }); await rename(temporary, operationPath(plans, operation.id)); }
async function readOperation(plans: string, id: string) { const path = operationPath(plans, id); await requireStablePath(path); const s = await lstat(path); requireThat(s.isFile() && !s.isSymbolicLink() && s.size <= 256 * 1024, "INVALID_CONFIG"); const value = validateMoveOperation(parseDataText(await readFile(path, "utf8"), "json", 256 * 1024)); requireThat(value.id === id, "INVALID_CONFIG"); return value; }
async function exists(path: string) { try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
async function observe(operation: MoveOperation, loaded: Loaded) {
  const sourcePresent = await exists(operation.source), destinationPresent = await exists(operation.destination);
  let destinationValid = false, reason = destinationPresent ? "destination identity mismatch" : "destination absent";
  if (destinationPresent) try { destinationValid = canonicalJson(await identity(operation.destination)) === canonicalJson(operation.identity); if (destinationValid) reason = "verified"; } catch {}
  const binding = loaded.localState.document.repositoryWorkspaces.find((entry) => entry.id === operation.workspaceId && entry.repositoryId === operation.repositoryId);
  return { sourcePresent, destinationPresent, destinationValid, bindingPath: binding?.path ?? null, bindingAtSource: binding?.path === operation.source, bindingAtDestination: binding?.path === operation.destination, reason };
}
export async function showMoveOperation(configPath: string, operationId: string) { const loaded = await loadRegistry(configPath); const operation = await readOperation(loaded.config.document.plans.directory, operationId); requireThat(operation.configPath === configPath, "CONFLICT"); const observation = await observe(operation, loaded); const status = !observation.sourcePresent && observation.destinationValid && observation.bindingAtDestination ? "completed" : "needs-attention"; return { operation: { ...operation, status, observation } }; }

export async function applyMovePlan(plan: WorkspacePlan, selectedConfigPath: string): Promise<any> {
  const request = plan.request as any; requireThat(selectedConfigPath === request.configPath, "STALE_PLAN");
  const derived = await deriveMovePlan({ configPath: request.configPath, workspaceId: request.workspaceId, destination: request.destination, confirmInactive: true }, plan.createdAt);
  requireThat(canonicalJson(workspacePlanSemanticFields(derived)) === canonicalJson(workspacePlanSemanticFields(plan)), "STALE_PLAN");
  let loaded = await loadRegistry(request.configPath); let operation: MoveOperation = { format: "workspacectl-operation/1", id: request.operationId, kind: "checkout-move", planId: plan.id, planDigest: plan.semanticDigest, configPath: request.configPath, repositoryId: request.repositoryId, workspaceId: request.workspaceId, source: request.source, destination: request.destination, identity: request.identity, status: "planned", outcome: null, updatedAt: new Date().toISOString() };
  await writeOperation(request.plansDirectory, operation);
  try {
    requireThat(!(await hasActiveProcess(request.source)), "BUSY"); await absent(request.destination, "STALE_PLAN");
    requireThat(canonicalJson(await identity(request.source)) === canonicalJson(request.identity), "STALE_PLAN");
    requireThat(String((await stat(dirname(request.destination))).dev) === request.identity.device, "UNSUPPORTED");
    operation = { ...operation, status: "running", updatedAt: new Date().toISOString() }; await writeOperation(request.plansDirectory, operation);
    await rename(request.source, request.destination);
    const moved = await identity(request.destination); requireThat(canonicalJson(moved) === canonicalJson(request.identity) && !(await exists(request.source)), "ACTION_FAILED");
    loaded = await loadRegistry(request.configPath); requireThat(loaded.localState.revision === plan.inputRevisions.localState, "ACTION_FAILED");
    const next = nextState(loaded, request.workspaceId, request.source, request.destination); requireThat(documentRevision(next) === request.localStateChange.nextRevision, "STALE_PLAN");
    await writeLocalStateDocument(new FileLocalStateStore(loaded.config.document.localState.path), loaded.localState.revision, next);
    const final = await loadRegistry(request.configPath); const observation = await observe(operation, final); requireThat(observation.destinationValid && observation.bindingAtDestination && !observation.sourcePresent, "ACTION_FAILED");
    operation = { ...operation, status: "completed", outcome: "checkout move and binding verified", updatedAt: new Date().toISOString() }; await writeOperation(request.plansDirectory, operation);
    return { planId: plan.id, kind: "checkout-move", revisions: { config: final.config.revision, catalog: final.catalog.revision, localState: final.localState.revision }, readback: { config: final.config.document, catalog: final.catalog.document, localState: final.localState.document }, operation };
  } catch (error) {
    const moved = !await exists(request.source) && await exists(request.destination);
    operation = { ...operation, status: moved ? "needs-attention" : "failed", outcome: moved ? "checkout renamed but binding update requires inspection" : (error instanceof GovernanceError ? error.message : "move failed"), updatedAt: new Date().toISOString() };
    await writeOperation(request.plansDirectory, operation); if (error instanceof GovernanceError) throw error; throw new GovernanceError("ACTION_FAILED");
  }
}

export async function createMoveReconcilePlan(configPath: string, operationId: string, createdAt = new Date().toISOString()): Promise<WorkspacePlan> {
  const loaded = await loadRegistry(configPath), shown = await showMoveOperation(configPath, operationId), operation = shown.operation as MoveOperation & { observation: any };
  requireThat(!operation.observation.sourcePresent && operation.observation.destinationValid && operation.observation.bindingAtSource && !operation.observation.bindingAtDestination, "UNSUPPORTED");
  const next = nextState(loaded, operation.workspaceId, operation.source, operation.destination), nextRevision = documentRevision(next);
  return finishPlan({ schemaVersion: 2, format: "workspacectl-plan/1", kind: "checkout-move-reconcile", createdAt,
    inputRevisions: { config: loaded.config.revision, catalog: loaded.catalog.revision, localState: loaded.localState.revision, sources: { operation: operation.planDigest, checkout: digest(operation.identity) } }, repositoryIds: [operation.repositoryId],
    request: { configPath, plansDirectory: loaded.config.document.plans.directory, operationId, repositoryId: operation.repositoryId, workspaceId: operation.workspaceId, source: operation.source, destination: operation.destination, identity: operation.identity as unknown as Json, localStateChange: { currentRevision: loaded.localState.revision, nextRevision } },
    actions: [{ id: "write-local-state", type: "document-cas", target: "local-state", path: loaded.config.document.localState.path, expectedRevision: loaded.localState.revision, nextRevision }],
    preconditions: [{ id: "operation-current", type: "source-digest", target: "operation", expected: operation.planDigest }, { id: "destination-exact", type: "source-digest", target: "checkout", expected: digest(operation.identity) }],
    expectedOutputs: [{ id: "local-state-edited", type: "document", target: "local-state", revision: nextRevision }], approvalsRequired: [{ id: "apply", kind: "explicit-plan-id" }] });
}
export async function applyMoveReconcilePlan(plan: WorkspacePlan, selectedConfigPath: string): Promise<any> {
  const request = plan.request as any; requireThat(selectedConfigPath === request.configPath, "STALE_PLAN"); const derived = await createMoveReconcilePlan(request.configPath, request.operationId, plan.createdAt); requireThat(canonicalJson(workspacePlanSemanticFields(derived)) === canonicalJson(workspacePlanSemanticFields(plan)), "STALE_PLAN");
  const loaded = await loadRegistry(request.configPath), operation = await readOperation(request.plansDirectory, request.operationId), next = nextState(loaded, request.workspaceId, request.source, request.destination);
  await writeLocalStateDocument(new FileLocalStateStore(loaded.config.document.localState.path), loaded.localState.revision, next);
  const final = await loadRegistry(request.configPath), observation = await observe(operation, final); requireThat(!observation.sourcePresent && observation.destinationValid && observation.bindingAtDestination, "ACTION_FAILED");
  const completed = { ...operation, status: "completed" as const, outcome: "verified moved checkout binding repaired", updatedAt: new Date().toISOString() }; await writeOperation(request.plansDirectory, completed);
  return { planId: plan.id, kind: "checkout-move-reconcile", revisions: { config: final.config.revision, catalog: final.catalog.revision, localState: final.localState.revision }, readback: { config: final.config.document, catalog: final.catalog.document, localState: final.localState.document }, operation: completed };
}
