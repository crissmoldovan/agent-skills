import { spawn } from "node:child_process";
import { readdir, readlink, lstat, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { canonicalJson, canonicalRemote, digest, GovernanceError, requireThat } from "./core.ts";
import type { Json } from "./core.ts";
import { contained } from "./discovery.ts";
import { FileCatalogStore, FileLocalStateStore, writeLocalStateDocument } from "./document-stores.ts";
import { requireStablePath } from "./path-safety.ts";
import { loadWorkspacesConfig } from "./registry-plans.ts";
import { MAX_DOCUMENT_BYTES, documentRevision, parseDataText, validateLocalStateDocument, validateWorkspacePlan, validateWorktreeBranch, workspacePlanSemanticFields } from "./v2-model.ts";
import type { CatalogDocument, LocalStateDocument, RepositoryWorkspace, WorkspacePlan, WorkspacesConfig } from "./v2-model.ts";

type Loaded = {
  config: { document: WorkspacesConfig; revision: string };
  catalog: { document: CatalogDocument; revision: string };
  localState: { document: LocalStateDocument; revision: string };
};

type GitResult = { stdout: string; stderr: string; code: number };

export interface WorktreeOperation {
  format: "workspacectl-operation/1";
  id: string;
  kind: "worktree-create" | "worktree-remove";
  planId: string;
  planDigest: string;
  configPath: string;
  repositoryId: string;
  workspaceId: string;
  primaryPath: string;
  path: string;
  branch: string;
  baseCommit: string;
  status: "planned" | "running" | "completed" | "failed" | "needs-attention";
  outcome: string | null;
  updatedAt: string;
}

export interface ListedWorktree {
  path: string;
  head: string;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  owned: boolean;
  workspaceId: string | null;
  primary: boolean;
}

export function validateWorktreeOperation(input: unknown): WorktreeOperation {
  exactKeys(input, ["format", "id", "kind", "planId", "planDigest", "configPath", "repositoryId", "workspaceId", "primaryPath", "path", "branch", "baseCommit", "status", "outcome", "updatedAt"]);
  requireThat(input.format === "workspacectl-operation/1" && ["worktree-create", "worktree-remove"].includes(input.kind), "INVALID_CONFIG");
  requireThat(typeof input.id === "string" && /^operation-[a-f0-9]{24}$/.test(input.id), "INVALID_CONFIG");
  requireThat(typeof input.planId === "string" && /^plan-[a-f0-9]{32}$/.test(input.planId), "INVALID_CONFIG");
  requireThat(typeof input.planDigest === "string" && /^[a-f0-9]{64}$/.test(input.planDigest), "INVALID_CONFIG");
  for (const path of [input.configPath, input.primaryPath, input.path]) requireThat(typeof path === "string" && path === resolve(path), "INVALID_CONFIG");
  for (const id of [input.repositoryId, input.workspaceId]) identifier(id);
  branchName(input.branch); commitId(input.baseCommit);
  requireThat(["planned", "running", "completed", "failed", "needs-attention"].includes(input.status), "INVALID_CONFIG");
  requireThat(input.outcome === null || (typeof input.outcome === "string" && input.outcome.length > 0 && input.outcome.length <= 16384), "INVALID_CONFIG");
  requireThat(typeof input.updatedAt === "string" && !Number.isNaN(Date.parse(input.updatedAt)) && new Date(input.updatedAt).toISOString() === input.updatedAt, "INVALID_CONFIG");
  return structuredClone(input) as WorktreeOperation;
}

function exactKeys(value: unknown, keys: readonly string[]): asserts value is Record<string, any> {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_CONFIG");
  requireThat(keys.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => keys.includes(key)), "INVALID_CONFIG");
}

function identifier(value: unknown): asserts value is string {
  requireThat(typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\x00-\x1f/\\]/.test(value), "INVALID_CONFIG");
}

function branchName(value: unknown): asserts value is string {
  validateWorktreeBranch(value);
}

function commitId(value: unknown): asserts value is string {
  requireThat(typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value), "INVALID_CONFIG");
}

async function runGit(args: string[], options: { cwd?: string; allowFailure?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<GitResult> {
  return new Promise((accept, reject) => {
    const child = spawn("git", args, {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: options.env?.GIT_TERMINAL_PROMPT ?? process.env.GIT_TERMINAL_PROMPT ?? "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let bytes = 0;
    const collect = (target: Buffer[]) => (chunk: Buffer) => { bytes += chunk.length; if (bytes <= 2 * 1024 * 1024) target.push(chunk); else child.kill(); };
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
    child.on("error", () => reject(new GovernanceError("TOOL_FAILURE")));
    child.on("close", (code) => {
      const result = { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), code: code ?? 1 };
      if (result.code === 0 || options.allowFailure) accept(result); else reject(new GovernanceError("ACTION_FAILED"));
    });
  });
}

async function loadRegistry(configPath: string): Promise<Loaded> {
  requireThat(configPath === resolve(configPath), "INVALID_CONFIG");
  const config = await loadWorkspacesConfig(configPath);
  const [catalog, localState] = await Promise.all([new FileCatalogStore(config.document.catalog.path).read(), new FileLocalStateStore(config.document.localState.path).read()]);
  requireThat(catalog.document !== null && catalog.freshness === "current" && localState.document !== null && localState.freshness === "current", "UNTRUSTED_INPUT");
  requireThat(localState.document.selectedConfig.path === configPath && localState.document.selectedConfig.revision === config.revision, "UNTRUSTED_INPUT");
  return { config, catalog: { ...catalog, document: catalog.document }, localState: { ...localState, document: localState.document } };
}

async function realDirectory(path: string): Promise<void> {
  await requireStablePath(path);
  const status = await lstat(path);
  requireThat(status.isDirectory() && !status.isSymbolicLink(), "INVALID_CONFIG");
}

async function absent(path: string, code = "CONFLICT"): Promise<void> {
  await requireStablePath(path, { allowMissing: true, code: "INVALID_CONFIG" });
  try { await lstat(path); throw new GovernanceError(code); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
}

async function canonicalOrigin(path: string): Promise<string> {
  const result = await runGit(["config", "--get", "remote.origin.url"], { cwd: path, allowFailure: true });
  requireThat(result.code === 0, "CONFLICT");
  return canonicalRemote(result.stdout.trim());
}

async function commonDirectory(path: string): Promise<string> {
  const result = await runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: path });
  return resolve(result.stdout.trim());
}

function selectedPrimary(loaded: Loaded, repositoryId: string): RepositoryWorkspace {
  const candidates = loaded.localState.document.repositoryWorkspaces.filter((entry) => entry.repositoryId === repositoryId && entry.kind === "primary");
  const selected = candidates.filter((entry) => entry.primarySelected);
  requireThat(selected.length <= 1, "CONFLICT");
  const result = selected[0] ?? (candidates.length === 1 ? candidates[0] : undefined);
  requireThat(result !== undefined, candidates.length === 0 ? "NOT_FOUND" : "CONFLICT");
  return result;
}

function finishPlan(plan: Omit<WorkspacePlan, "id" | "semanticDigest">): WorkspacePlan {
  const placeholder = { ...plan, id: `plan-${"0".repeat(32)}`, semanticDigest: "0".repeat(64) } as WorkspacePlan;
  const semanticDigest = digest(workspacePlanSemanticFields(placeholder));
  return validateWorkspacePlan({ ...plan, id: `plan-${semanticDigest.slice(0, 32)}`, semanticDigest });
}

function worktreeId(repositoryId: string, path: string): string {
  return `workspace-${digest({ repositoryId, path }).slice(0, 24)}`;
}

function operationId(kind: string, fields: Record<string, Json>, loaded: Loaded): string {
  return `operation-${digest({ kind, ...fields, revisions: [loaded.config.revision, loaded.catalog.revision, loaded.localState.revision] }).slice(0, 24)}`;
}

function nextCreateState(loaded: Loaded, request: any): LocalStateDocument {
  const next = structuredClone(loaded.localState.document);
  requireThat(!next.repositoryWorkspaces.some((entry) => entry.id === request.workspaceId || entry.path === request.path || (entry.repositoryId === request.repositoryId && entry.branch === request.branch)), "CONFLICT");
  next.repositoryWorkspaces.push({ id: request.workspaceId, kind: "worktree", repositoryId: request.repositoryId, path: request.path, branch: request.branch, primarySelected: false, hostLinks: {} });
  return validateLocalStateDocument(next);
}

function nextRemoveState(loaded: Loaded, workspaceId: string): LocalStateDocument {
  const next = structuredClone(loaded.localState.document);
  const index = next.repositoryWorkspaces.findIndex((entry) => entry.id === workspaceId && entry.kind === "worktree");
  requireThat(index >= 0, "NOT_FOUND");
  requireThat(!next.workspacePolicyOverlays.some((entry) => entry.scope.id === workspaceId) && !(next.workspaceWorkflowOverlays ?? []).some((entry) => entry.scope.id === workspaceId), "CONFLICT");
  next.repositoryWorkspaces.splice(index, 1);
  return validateLocalStateDocument(next);
}

function parsePorcelain(output: string): Array<Omit<ListedWorktree, "owned" | "workspaceId" | "primary">> {
  return output.trimEnd().split("\n\n").filter(Boolean).map((block) => {
    const lines = block.split("\n");
    const values = new Map(lines.filter((line) => line.includes(" ")).map((line) => [line.slice(0, line.indexOf(" ")), line.slice(line.indexOf(" ") + 1)]));
    const flags = new Set(lines.filter((line) => !line.includes(" ")));
    const path = values.get("worktree"), head = values.get("HEAD");
    requireThat(path !== undefined && head !== undefined, "TOOL_FAILURE");
    return { path: resolve(path), head, branch: values.get("branch")?.replace(/^refs\/heads\//, "") ?? null, bare: flags.has("bare"), detached: flags.has("detached"), locked: lines.some((line) => line === "locked" || line.startsWith("locked ")), prunable: lines.some((line) => line === "prunable" || line.startsWith("prunable ")) };
  });
}

export async function listWorktrees(configPath: string, repositoryId: string): Promise<{ repositoryId: string; primaryWorkspaceId: string; worktrees: ListedWorktree[]; revisions: { config: string; catalog: string; localState: string } }> {
  identifier(repositoryId);
  const loaded = await loadRegistry(configPath);
  const repository = loaded.catalog.document.repositories.find((entry) => entry.id === repositoryId);
  requireThat(repository !== undefined, "NOT_FOUND");
  const primary = selectedPrimary(loaded, repositoryId);
  await realDirectory(primary.path);
  requireThat(await canonicalOrigin(primary.path) === canonicalRemote(repository.remote), "CONFLICT");
  const parsed = parsePorcelain((await runGit(["worktree", "list", "--porcelain"], { cwd: primary.path })).stdout);
  const worktrees = parsed.map((entry) => {
    const binding = loaded.localState.document.repositoryWorkspaces.find((candidate) => candidate.repositoryId === repositoryId && candidate.path === entry.path);
    return { ...entry, owned: binding !== undefined, workspaceId: binding?.id ?? null, primary: entry.path === primary.path };
  });
  return { repositoryId, primaryWorkspaceId: primary.id, worktrees, revisions: { config: loaded.config.revision, catalog: loaded.catalog.revision, localState: loaded.localState.revision } };
}

export async function createWorktreePlan(input: { configPath: string; repositoryId: string; base: string; branch: string; path: string }, createdAt = new Date().toISOString()): Promise<WorkspacePlan> {
  exactKeys(input, ["configPath", "repositoryId", "base", "branch", "path"]);
  identifier(input.repositoryId); branchName(input.branch); commitId(input.base);
  requireThat(input.path === resolve(input.path), "INVALID_CONFIG");
  const loaded = await loadRegistry(input.configPath);
  const repository = loaded.catalog.document.repositories.find((entry) => entry.id === input.repositoryId);
  requireThat(repository !== undefined, "NOT_FOUND");
  const primary = selectedPrimary(loaded, input.repositoryId);
  await realDirectory(primary.path); await realDirectory(dirname(input.path)); await absent(input.path);
  requireThat(loaded.config.document.trustedRoots.some((root) => contained(root, input.path)), "INVALID_CONFIG");
  requireThat(!contained(primary.path, input.path) && !contained(input.path, primary.path), "INVALID_CONFIG");
  requireThat(await canonicalOrigin(primary.path) === canonicalRemote(repository.remote), "CONFLICT");
  const validBranch = await runGit(["check-ref-format", "--branch", input.branch], { cwd: primary.path, allowFailure: true });
  requireThat(validBranch.code === 0, "INVALID_CONFIG");
  const resolvedBase = (await runGit(["rev-parse", "--verify", `${input.base}^{commit}`], { cwd: primary.path, allowFailure: true })).stdout.trim();
  requireThat(resolvedBase === input.base, "NOT_FOUND");
  const existingBranch = await runGit(["show-ref", "--verify", `refs/heads/${input.branch}`], { cwd: primary.path, allowFailure: true });
  requireThat(existingBranch.code !== 0, "CONFLICT");
  const listed = await listWorktrees(input.configPath, input.repositoryId);
  requireThat(!listed.worktrees.some((entry) => entry.path === input.path || entry.branch === input.branch), "CONFLICT");
  const workspaceId = worktreeId(input.repositoryId, input.path);
  const opId = operationId("worktree-create", { repositoryId: input.repositoryId, base: input.base, branch: input.branch, path: input.path }, loaded);
  const request = { configPath: input.configPath, plansDirectory: loaded.config.document.plans.directory, operationId: opId, repositoryId: input.repositoryId, remote: canonicalRemote(repository.remote), primaryPath: primary.path, primaryWorkspaceId: primary.id, baseCommit: input.base, branch: input.branch, path: input.path, workspaceId };
  const next = nextCreateState(loaded, request), nextRevision = documentRevision(next);
  return finishPlan({ schemaVersion: 2, format: "workspacectl-plan/1", kind: "worktree-create", createdAt,
    inputRevisions: { config: loaded.config.revision, catalog: loaded.catalog.revision, localState: loaded.localState.revision, sources: { baseCommit: digest(input.base), worktreeList: digest(listed.worktrees) } }, repositoryIds: [input.repositoryId],
    request: { ...request, localStateChange: { currentRevision: loaded.localState.revision, nextRevision } },
    actions: [{ id: "create-worktree", type: "git-worktree-add", path: input.path }, { id: "write-local-state", type: "document-cas", target: "local-state", path: loaded.config.document.localState.path, expectedRevision: loaded.localState.revision, nextRevision }],
    preconditions: [{ id: "base-exact", type: "source-digest", target: "base-commit", expected: input.base }, { id: "path-absent", type: "revision", target: "worktree-path", expected: "absent" }, { id: "branch-absent", type: "source-digest", target: "branch", expected: digest(input.branch) }],
    expectedOutputs: [{ id: "local-state-edited", type: "document", target: "local-state", revision: nextRevision }], approvalsRequired: [{ id: "apply", kind: "explicit-plan-id" }] });
}

async function hasActiveProcess(path: string): Promise<boolean> {
  if (process.platform !== "linux") return false;
  let entries: string[];
  try { entries = await readdir("/proc"); } catch { return false; }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    try { const cwd = await readlink(`/proc/${entry}/cwd`); if (contained(path, resolve(cwd))) return true; } catch {}
  }
  return false;
}

async function cleanWorktree(path: string): Promise<boolean> {
  const status = await runGit(["status", "--porcelain=v1", "--untracked-files=all"], { cwd: path, allowFailure: true });
  if (status.code !== 0 || status.stdout.length !== 0) return false;
  const files = await runGit(["ls-tree", "-r", "--name-only", "-z", "HEAD"], { cwd: path, allowFailure: true });
  if (files.code !== 0) return false;
  for (const relative of files.stdout.split("\0").filter(Boolean)) {
    const expected = await runGit(["show", `HEAD:${relative}`], { cwd: path, allowFailure: true });
    if (expected.code !== 0) continue;
    try { if (!Buffer.from(expected.stdout).equals(await readFile(join(path, relative)))) return false; } catch { return false; }
  }
  return true;
}

async function pushedOrBase(path: string, head: string): Promise<boolean> {
  const refs = await runGit(["ls-remote", "--refs", "origin"], { cwd: path, allowFailure: true });
  if (refs.code !== 0) throw new GovernanceError("UNAVAILABLE");
  for (const line of refs.stdout.split("\n").filter(Boolean)) {
    const tip = line.split("\t")[0];
    if (tip === head) return true;
    const known = await runGit(["cat-file", "-e", `${tip}^{commit}`], { cwd: path, allowFailure: true });
    if (known.code === 0 && (await runGit(["merge-base", "--is-ancestor", head, tip], { cwd: path, allowFailure: true })).code === 0) return true;
  }
  return false;
}

async function removalObservation(loaded: Loaded, workspace: RepositoryWorkspace, confirmInactive: boolean) {
  requireThat(confirmInactive, "APPROVAL_REQUIRED");
  requireThat(workspace.kind === "worktree" && workspace.branch !== null && Object.keys(workspace.hostLinks).length === 0, "CONFLICT");
  await realDirectory(workspace.path);
  const repository = loaded.catalog.document.repositories.find((entry) => entry.id === workspace.repositoryId);
  requireThat(repository !== undefined && await canonicalOrigin(workspace.path) === canonicalRemote(repository.remote), "CONFLICT");
  const primary = selectedPrimary(loaded, workspace.repositoryId);
  requireThat(await commonDirectory(workspace.path) === await commonDirectory(primary.path), "CONFLICT");
  const listed = await listWorktrees(workspace.path === primary.path ? loaded.config.document.localState.path : loaded.localState.document.selectedConfig.path, workspace.repositoryId);
  const actual = listed.worktrees.find((entry) => entry.path === workspace.path);
  requireThat(actual !== undefined && actual.owned && !actual.bare && !actual.detached && actual.branch === workspace.branch, "CONFLICT");
  requireThat(!actual.locked && !actual.prunable && !(await hasActiveProcess(workspace.path)), "BUSY");
  requireThat(await cleanWorktree(workspace.path), "CONFLICT");
  const head = (await runGit(["rev-parse", "HEAD"], { cwd: workspace.path })).stdout.trim();
  commitId(head);
  requireThat(await pushedOrBase(workspace.path, head), "CONFLICT");
  return { primary, head, branch: workspace.branch, commonDirectory: await commonDirectory(primary.path), worktreeListDigest: digest(listed.worktrees) };
}

export async function createWorktreeRemovePlan(input: { configPath: string; workspaceId: string; confirmInactive: boolean }, createdAt = new Date().toISOString()): Promise<WorkspacePlan> {
  exactKeys(input, ["configPath", "workspaceId", "confirmInactive"]); identifier(input.workspaceId); requireThat(typeof input.confirmInactive === "boolean", "INVALID_CONFIG");
  const loaded = await loadRegistry(input.configPath);
  const workspace = loaded.localState.document.repositoryWorkspaces.find((entry) => entry.id === input.workspaceId);
  requireThat(workspace !== undefined && workspace.kind === "worktree", "NOT_FOUND");
  const observation = await removalObservation(loaded, workspace, input.confirmInactive);
  const opId = operationId("worktree-remove", { workspaceId: workspace.id, path: workspace.path, head: observation.head }, loaded);
  const next = nextRemoveState(loaded, workspace.id), nextRevision = documentRevision(next);
  return finishPlan({ schemaVersion: 2, format: "workspacectl-plan/1", kind: "worktree-remove", createdAt,
    inputRevisions: { config: loaded.config.revision, catalog: loaded.catalog.revision, localState: loaded.localState.revision, sources: { worktreeHead: digest(observation.head), worktreeList: observation.worktreeListDigest } }, repositoryIds: [workspace.repositoryId],
    request: { configPath: input.configPath, plansDirectory: loaded.config.document.plans.directory, operationId: opId, repositoryId: workspace.repositoryId, workspaceId: workspace.id, primaryPath: observation.primary.path, path: workspace.path, branch: workspace.branch!, baseCommit: observation.head, confirmInactive: true, commonDirectory: observation.commonDirectory, localStateChange: { currentRevision: loaded.localState.revision, nextRevision } },
    actions: [{ id: "remove-worktree", type: "git-worktree-remove", path: workspace.path }, { id: "write-local-state", type: "document-cas", target: "local-state", path: loaded.config.document.localState.path, expectedRevision: loaded.localState.revision, nextRevision }],
    preconditions: [{ id: "worktree-clean", type: "source-digest", target: "worktree-head", expected: observation.head }, { id: "inactive-confirmed", type: "source-digest", target: "inactive", expected: digest(true) }],
    expectedOutputs: [{ id: "local-state-edited", type: "document", target: "local-state", revision: nextRevision }], approvalsRequired: [{ id: "apply", kind: "explicit-plan-id" }] });
}

function operationPath(directory: string, id: string): string { return join(directory, "operations", `${id}.json`); }
function authorityPath(directory: string, id: string): string { return join(directory, "authoritative-plans", `${id}.json`); }

export async function saveWorktreePlanAuthority(plan: WorkspacePlan): Promise<void> {
  requireThat(plan.kind === "worktree-create" || plan.kind === "worktree-remove", "INVALID_CONFIG");
  const directory = plan.request.plansDirectory;
  requireThat(typeof directory === "string" && directory === resolve(directory), "INVALID_CONFIG");
  const authorityDirectory = join(directory, "authoritative-plans");
  await mkdir(authorityDirectory, { recursive: true, mode: 0o700 });
  await requireStablePath(authorityDirectory);
  const target = authorityPath(directory, plan.id);
  const bytes = JSON.stringify(plan, null, 2) + "\n";
  let handle;
  try {
    handle = await open(target, "wx", 0o600);
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new GovernanceError("ACTION_FAILED");
    const existing = await readWorktreePlanAuthority(directory, plan.id);
    requireThat(canonicalJson(existing) === canonicalJson(plan), "CONFLICT");
  } finally {
    await handle?.close();
  }
}

async function readWorktreePlanAuthority(directory: string, planId: string): Promise<WorkspacePlan> {
  try {
    const path = authorityPath(directory, planId);
    await requireStablePath(path);
    const status = await lstat(path);
    requireThat(status.isFile() && !status.isSymbolicLink() && status.size <= MAX_DOCUMENT_BYTES, "STALE_PLAN");
    const plan = validateWorkspacePlan(parseDataText(await readFile(path, "utf8"), "json", MAX_DOCUMENT_BYTES));
    requireThat(plan.id === planId && (plan.kind === "worktree-create" || plan.kind === "worktree-remove"), "STALE_PLAN");
    requireThat(digest(workspacePlanSemanticFields(plan)) === plan.semanticDigest && plan.id === `plan-${plan.semanticDigest.slice(0, 32)}`, "STALE_PLAN");
    return plan;
  } catch (error) {
    if (error instanceof GovernanceError && error.code === "STALE_PLAN") throw error;
    throw new GovernanceError("STALE_PLAN");
  }
}

async function writeOperation(directory: string, operation: WorktreeOperation): Promise<void> {
  operation = validateWorktreeOperation(operation);
  await mkdir(join(directory, "operations"), { recursive: true, mode: 0o700 });
  const target = operationPath(directory, operation.id), temporary = `${target}.${process.pid}.${createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 8)}.tmp`;
  await writeFile(temporary, JSON.stringify(operation, null, 2) + "\n", { mode: 0o600, flag: "wx" }); await rename(temporary, target);
}

async function readWorktreeOperation(directory: string, operationId: string): Promise<WorktreeOperation> {
  const path = operationPath(directory, operationId);
  await requireStablePath(path);
  const status = await lstat(path);
  requireThat(status.isFile() && !status.isSymbolicLink() && status.size <= 256 * 1024, "INVALID_CONFIG");
  const operation = validateWorktreeOperation(parseDataText(await readFile(path, "utf8"), "json", 256 * 1024));
  requireThat(operation.id === operationId, "INVALID_CONFIG");
  return operation;
}

export async function showWorktreeOperation(configPath: string, operationId: string): Promise<{ operation: WorktreeOperation & { observation: any; bindingPresent: boolean } }> {
  const loaded = await loadRegistry(configPath);
  const operation = await readWorktreeOperation(loaded.config.document.plans.directory, operationId);
  requireThat(operation.configPath === configPath, "CONFLICT");
  const listed = await listWorktrees(configPath, operation.repositoryId);
  const actual = listed.worktrees.find((entry) => entry.path === operation.path);
  const bindingPresent = loaded.localState.document.repositoryWorkspaces.some((entry) =>
    entry.id === operation.workspaceId && entry.repositoryId === operation.repositoryId &&
    entry.path === operation.path && entry.branch === operation.branch && entry.kind === "worktree"
  );
  let pathPresent = false;
  try { const status = await lstat(operation.path); pathPresent = status.isDirectory() || status.isFile() || status.isSymbolicLink(); } catch {}
  const branchRetained = (await runGit(["show-ref", "--verify", `refs/heads/${operation.branch}`], { cwd: operation.primaryPath, allowFailure: true })).code === 0;
  const valid = operation.kind === "worktree-create"
    ? pathPresent && bindingPresent && actual?.owned === true && actual.workspaceId === operation.workspaceId && actual.branch === operation.branch && actual.head === operation.baseCommit
    : !pathPresent && !bindingPresent && actual === undefined && branchRetained;
  const observation = {
    valid,
    reason: valid ? "verified" : operation.kind === "worktree-create" ? "worktree or binding mismatch" : "worktree remains, binding remains, or branch is absent",
    pathPresent,
    listed: actual !== undefined,
    branch: actual?.branch ?? null,
    head: actual?.head ?? null,
    branchRetained,
  };
  return { operation: { ...operation, status: valid ? "completed" : "needs-attention", observation, bindingPresent } };
}

function operationFromPlan(plan: WorkspacePlan, status: WorktreeOperation["status"], outcome: string | null): WorktreeOperation {
  const r = plan.request as any;
  return { format: "workspacectl-operation/1", id: r.operationId, kind: plan.kind as WorktreeOperation["kind"], planId: plan.id, planDigest: plan.semanticDigest, configPath: r.configPath, repositoryId: r.repositoryId, workspaceId: r.workspaceId, primaryPath: r.primaryPath, path: r.path, branch: r.branch, baseCommit: r.baseCommit, status, outcome, updatedAt: new Date().toISOString() };
}
async function readback(loaded: Loaded) { return { revisions: { config: loaded.config.revision, catalog: loaded.catalog.revision, localState: loaded.localState.revision }, readback: { config: loaded.config.document, catalog: loaded.catalog.document, localState: loaded.localState.document } }; }

export async function applyWorktreePlan(plan: WorkspacePlan, selectedConfigPath: string): Promise<any> {
  const selected = await loadRegistry(selectedConfigPath);
  const authoritative = await readWorktreePlanAuthority(selected.config.document.plans.directory, plan.id);
  requireThat(canonicalJson(authoritative) === canonicalJson(plan), "STALE_PLAN");
  plan = authoritative;
  const request = plan.request as any;
  requireThat(selectedConfigPath === request.configPath, "STALE_PLAN");
  const derived = plan.kind === "worktree-create"
    ? await createWorktreePlan({ configPath: request.configPath, repositoryId: request.repositoryId, base: request.baseCommit, branch: request.branch, path: request.path }, plan.createdAt)
    : await createWorktreeRemovePlan({ configPath: request.configPath, workspaceId: request.workspaceId, confirmInactive: request.confirmInactive }, plan.createdAt);
  requireThat(canonicalJson(workspacePlanSemanticFields(derived)) === canonicalJson(workspacePlanSemanticFields(plan)), "STALE_PLAN");
  let loaded = await loadRegistry(request.configPath);
  requireThat(loaded.config.revision === plan.inputRevisions.config && loaded.catalog.revision === plan.inputRevisions.catalog && loaded.localState.revision === plan.inputRevisions.localState, "STALE_PLAN");
  let operation = operationFromPlan(plan, "planned", null); await writeOperation(request.plansDirectory, operation);
  try {
    operation = { ...operation, status: "running", updatedAt: new Date().toISOString() }; await writeOperation(request.plansDirectory, operation);
    if (plan.kind === "worktree-create") {
      await absent(request.path, "STALE_PLAN");
      await runGit(["-c", "core.hooksPath=/dev/null", "worktree", "add", "-b", request.branch, request.path, request.baseCommit], { cwd: request.primaryPath });
      const branch = (await runGit(["symbolic-ref", "--short", "HEAD"], { cwd: request.path })).stdout.trim();
      const head = (await runGit(["rev-parse", "HEAD"], { cwd: request.path })).stdout.trim();
      requireThat(branch === request.branch && head === request.baseCommit && await commonDirectory(request.path) === await commonDirectory(request.primaryPath), "ACTION_FAILED");
      loaded = await loadRegistry(request.configPath);
      requireThat(loaded.localState.revision === plan.inputRevisions.localState, "ACTION_FAILED");
      const next = nextCreateState(loaded, request); requireThat(documentRevision(next) === request.localStateChange.nextRevision, "STALE_PLAN");
      await writeLocalStateDocument(new FileLocalStateStore(loaded.config.document.localState.path), loaded.localState.revision, next);
    } else {
      const workspace = loaded.localState.document.repositoryWorkspaces.find((entry) => entry.id === request.workspaceId)!;
      await removalObservation(loaded, workspace, true);
      await runGit(["worktree", "remove", request.path], { cwd: request.primaryPath });
      try { await lstat(request.path); throw new GovernanceError("ACTION_FAILED"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const branch = await runGit(["show-ref", "--verify", `refs/heads/${request.branch}`], { cwd: request.primaryPath, allowFailure: true }); requireThat(branch.code === 0, "ACTION_FAILED");
      loaded = await loadRegistry(request.configPath); requireThat(loaded.localState.revision === plan.inputRevisions.localState, "ACTION_FAILED");
      const next = nextRemoveState(loaded, request.workspaceId); requireThat(documentRevision(next) === request.localStateChange.nextRevision, "STALE_PLAN");
      await writeLocalStateDocument(new FileLocalStateStore(loaded.config.document.localState.path), loaded.localState.revision, next);
    }
    const final = await loadRegistry(request.configPath);
    const finalList = await listWorktrees(request.configPath, request.repositoryId);
    if (plan.kind === "worktree-create") {
      const actual = finalList.worktrees.find((entry) => entry.path === request.path);
      requireThat(actual?.owned === true && actual.workspaceId === request.workspaceId && actual.branch === request.branch && actual.head === request.baseCommit, "ACTION_FAILED");
    } else {
      requireThat(!finalList.worktrees.some((entry) => entry.path === request.path), "ACTION_FAILED");
      requireThat(!final.localState.document.repositoryWorkspaces.some((entry) => entry.id === request.workspaceId), "ACTION_FAILED");
    }
    operation = { ...operation, status: "completed", outcome: plan.kind === "worktree-create" ? "worktree and binding verified" : "worktree removed, branch retained, and binding removed", updatedAt: new Date().toISOString() }; await writeOperation(request.plansDirectory, operation);
    return { planId: plan.id, kind: plan.kind, ...(await readback(final)), operation };
  } catch (error) {
    operation = { ...operation, status: "needs-attention", outcome: error instanceof GovernanceError ? error.code : "worktree operation failed", updatedAt: new Date().toISOString() }; await writeOperation(request.plansDirectory, operation);
    if (error instanceof GovernanceError) throw error;
    throw new GovernanceError("ACTION_FAILED");
  }
}
