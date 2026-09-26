import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { canonicalJson, canonicalRemote, digest, GovernanceError, requireThat } from "./core.ts";
import type { Json } from "./core.ts";
import { FileCatalogStore, FileLocalStateStore, writeLocalStateDocument } from "./document-stores.ts";
import { contained } from "./discovery.ts";
import { requireStablePath } from "./path-safety.ts";
import { loadWorkspacesConfig } from "./registry-plans.ts";
import {
  ABSENT_REVISION,
  documentRevision,
  parseDataText,
  validateLocalStateDocument,
  validateWorkspacePlan,
  workspacePlanSemanticFields,
} from "./v2-model.ts";
import type { CatalogDocument, LocalStateDocument, WorkspacePlan, WorkspacesConfig } from "./v2-model.ts";

export interface CheckoutRequest {
  configPath: string;
  repositoryId: string;
  destination: string;
  ref?: string;
}

export interface CheckoutOperation {
  format: "workspacectl-operation/1";
  id: string;
  kind: "checkout";
  planId: string;
  planDigest: string;
  configPath: string;
  repositoryId: string;
  remote: string;
  requestedRef: string;
  resolved: { kind: "branch" | "tag" | "commit"; name: string | null; commit: string };
  destination: string;
  stagingPath: string;
  workspaceId: string;
  status: "planned" | "running" | "completed" | "failed" | "needs-attention";
  outcome: string | null;
  updatedAt: string;
}

export function validateCheckoutOperation(input: unknown): CheckoutOperation {
  exactKeys(input, ["format", "id", "kind", "planId", "planDigest", "configPath", "repositoryId", "remote", "requestedRef", "resolved", "destination", "stagingPath", "workspaceId", "status", "outcome", "updatedAt"]);
  requireThat(input.format === "workspacectl-operation/1" && input.kind === "checkout", "INVALID_CONFIG");
  requireThat(typeof input.id === "string" && /^operation-[a-f0-9]{24}$/.test(input.id), "INVALID_CONFIG");
  requireThat(typeof input.planId === "string" && /^plan-[a-f0-9]{32}$/.test(input.planId), "INVALID_CONFIG");
  requireThat(typeof input.planDigest === "string" && /^[a-f0-9]{64}$/.test(input.planDigest), "INVALID_CONFIG");
  for (const path of [input.configPath, input.destination, input.stagingPath]) requireThat(typeof path === "string" && path === resolve(path), "INVALID_CONFIG");
  for (const id of [input.repositoryId, input.workspaceId]) requireThat(typeof id === "string" && id.length > 0 && id.length <= 256 && !/[\x00-\x1f/\\]/.test(id), "INVALID_CONFIG");
  requireThat(typeof input.remote === "string" && canonicalRemote(input.remote) === input.remote, "INVALID_CONFIG");
  requireThat(typeof input.requestedRef === "string" && input.requestedRef.length > 0 && input.requestedRef.length <= 1100 && !/[\x00-\x1f]/.test(input.requestedRef), "INVALID_CONFIG");
  exactKeys(input.resolved, ["kind", "name", "commit"]);
  requireThat(["branch", "tag", "commit"].includes(input.resolved.kind) && typeof input.resolved.commit === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.resolved.commit), "INVALID_CONFIG");
  requireThat(input.resolved.name === null || (typeof input.resolved.name === "string" && input.resolved.name.length > 0 && input.resolved.name.length <= 1024), "INVALID_CONFIG");
  requireThat((input.resolved.kind === "commit") === (input.resolved.name === null), "INVALID_CONFIG");
  requireThat(["planned", "running", "completed", "failed", "needs-attention"].includes(input.status), "INVALID_CONFIG");
  requireThat(input.outcome === null || (typeof input.outcome === "string" && input.outcome.length > 0 && input.outcome.length <= 16384), "INVALID_CONFIG");
  requireThat(typeof input.updatedAt === "string" && !Number.isNaN(Date.parse(input.updatedAt)) && new Date(input.updatedAt).toISOString() === input.updatedAt, "INVALID_CONFIG");
  return structuredClone(input) as CheckoutOperation;
}

type Loaded = {
  config: { document: WorkspacesConfig; revision: string };
  catalog: { document: CatalogDocument; revision: string };
  localState: { document: LocalStateDocument; revision: string };
};

function exactKeys(value: unknown, keys: readonly string[], optional: readonly string[] = []): asserts value is Record<string, any> {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_CONFIG");
  requireThat(keys.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => keys.includes(key) || optional.includes(key)), "INVALID_CONFIG");
}

async function loadRegistry(configPath: string): Promise<Loaded> {
  requireThat(configPath === resolve(configPath), "INVALID_CONFIG");
  const config = await loadWorkspacesConfig(configPath);
  const [catalog, localState] = await Promise.all([
    new FileCatalogStore(config.document.catalog.path).read(),
    new FileLocalStateStore(config.document.localState.path).read(),
  ]);
  requireThat(catalog.document !== null && catalog.freshness === "current" && localState.document !== null && localState.freshness === "current", "UNTRUSTED_INPUT");
  requireThat(localState.document.selectedConfig.path === configPath && localState.document.selectedConfig.revision === config.revision, "UNTRUSTED_INPUT");
  return { config, catalog: { ...catalog, document: catalog.document }, localState: { ...localState, document: localState.document } };
}

async function pathAbsent(path: string, code = "CONFLICT"): Promise<void> {
  await requireStablePath(path, { allowMissing: true, code: "INVALID_CONFIG" });
  try { await lstat(path); throw new GovernanceError(code); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
}

async function realDirectory(path: string): Promise<void> {
  await requireStablePath(path);
  const status = await lstat(path);
  requireThat(status.isDirectory() && !status.isSymbolicLink(), "INVALID_CONFIG");
}

async function runGit(args: string[], options: { cwd?: string; allowFailure?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<{ stdout: string; stderr: string; code: number }> {
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

function validateRefName(name: string): void {
  requireThat(name.length > 0 && name.length <= 1024 && !/[\x00-\x20\x7f~^:?*[\\]/.test(name) && !name.includes("..") && !name.includes("@{") && !name.endsWith(".") && !name.endsWith("/"), "INVALID_CONFIG");
}

async function resolveRemoteRef(remote: string, requested = "default"): Promise<CheckoutOperation["resolved"]> {
  requireThat(typeof requested === "string" && requested.length > 0 && requested.length <= 1100, "INVALID_CONFIG");
  if (requested === "default") {
    const result = await runGit(["ls-remote", "--symref", remote, "HEAD"]);
    const symbolic = result.stdout.split("\n").find((line) => line.startsWith("ref: ") && line.endsWith("\tHEAD"));
    const commitLine = result.stdout.split("\n").find((line) => /^[a-f0-9]{40,64}\tHEAD$/.test(line));
    requireThat(symbolic !== undefined && commitLine !== undefined, "UNAVAILABLE");
    const full = symbolic.slice(5, symbolic.indexOf("\t"));
    requireThat(full.startsWith("refs/heads/"), "UNSUPPORTED");
    return { kind: "branch", name: full.slice("refs/heads/".length), commit: commitLine.split("\t")[0] };
  }
  const separator = requested.indexOf(":");
  requireThat(separator > 0, "INVALID_CONFIG");
  const kind = requested.slice(0, separator), name = requested.slice(separator + 1);
  if (kind === "branch") {
    validateRefName(name);
    const target = `refs/heads/${name}`;
    const result = await runGit(["ls-remote", remote, target]);
    const line = result.stdout.trim().split("\n").find((entry) => entry.endsWith(`\t${target}`));
    requireThat(line !== undefined, "NOT_FOUND");
    return { kind, name, commit: line.split("\t")[0] };
  }
  if (kind === "tag") {
    validateRefName(name);
    const target = `refs/tags/${name}`;
    const result = await runGit(["ls-remote", remote, target, `${target}^{}`]);
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    const peeled = lines.find((entry) => entry.endsWith(`\t${target}^{}`)) ?? lines.find((entry) => entry.endsWith(`\t${target}`));
    requireThat(peeled !== undefined, "NOT_FOUND");
    return { kind, name, commit: peeled.split("\t")[0] };
  }
  requireThat(kind === "commit" && /^[a-f0-9]{40}([a-f0-9]{24})?$/.test(name), "INVALID_CONFIG");
  const result = await runGit(["ls-remote", remote]);
  requireThat(result.stdout.split("\n").some((line) => line.startsWith(`${name}\t`)), "NOT_FOUND");
  return { kind: "commit", name: null, commit: name };
}

function finishPlan(plan: Omit<WorkspacePlan, "id" | "semanticDigest">): WorkspacePlan {
  const placeholder = { ...plan, id: `plan-${"0".repeat(32)}`, semanticDigest: "0".repeat(64) } as WorkspacePlan;
  const semanticDigest = digest(workspacePlanSemanticFields(placeholder));
  return validateWorkspacePlan({ ...plan, id: `plan-${semanticDigest.slice(0, 32)}`, semanticDigest });
}

function workspaceId(repositoryId: string, destination: string): string {
  return `workspace-${digest({ repositoryId, path: destination }).slice(0, 24)}`;
}

function nextStateForCheckout(loaded: Loaded, request: { repositoryId: string; destination: string; workspaceId: string; resolved: CheckoutOperation["resolved"] }): LocalStateDocument {
  const next = structuredClone(loaded.localState.document);
  requireThat(!next.repositoryWorkspaces.some((workspace) => workspace.id === request.workspaceId || workspace.path === request.destination), "CONFLICT");
  next.repositoryWorkspaces.push({ id: request.workspaceId, kind: "primary", repositoryId: request.repositoryId, path: request.destination, branch: request.resolved.kind === "branch" ? request.resolved.name : null, primarySelected: false, hostLinks: {} });
  return validateLocalStateDocument(next);
}

async function deriveCheckoutPlan(input: CheckoutRequest, createdAt: string, requireAbsent: boolean): Promise<WorkspacePlan> {
  exactKeys(input, ["configPath", "repositoryId", "destination"], ["ref"]);
  requireThat(input.destination === resolve(input.destination), "INVALID_CONFIG");
  const loaded = await loadRegistry(input.configPath);
  const repository = loaded.catalog.document.repositories.find((candidate) => candidate.id === input.repositoryId);
  requireThat(repository !== undefined, "NOT_FOUND");
  requireThat(loaded.config.document.trustedRoots.some((root) => contained(root, input.destination)), "INVALID_CONFIG");
  await realDirectory(dirname(input.destination));
  if (requireAbsent) await pathAbsent(input.destination);
  requireThat(!loaded.localState.document.repositoryWorkspaces.some((workspace) => workspace.repositoryId === input.repositoryId || workspace.path === input.destination), "CONFLICT");
  const remote = canonicalRemote(repository.remote);
  const requestedRef = input.ref ?? "default";
  const resolvedRef = await resolveRemoteRef(remote, requestedRef);
  const operationId = `operation-${digest({ repositoryId: input.repositoryId, destination: input.destination, requestedRef, resolvedRef, revisions: [loaded.config.revision, loaded.catalog.revision, loaded.localState.revision] }).slice(0, 24)}`;
  const stagingPath = join(dirname(input.destination), `.${basename(input.destination)}.workspacectl-${operationId.slice(-12)}.partial`);
  if (requireAbsent) await pathAbsent(stagingPath);
  const id = workspaceId(input.repositoryId, input.destination);
  const next = nextStateForCheckout(loaded, { repositoryId: input.repositoryId, destination: input.destination, workspaceId: id, resolved: resolvedRef });
  const nextRevision = documentRevision(next);
  return finishPlan({
    schemaVersion: 2, format: "workspacectl-plan/1", kind: "checkout", createdAt,
    inputRevisions: { config: loaded.config.revision, catalog: loaded.catalog.revision, localState: loaded.localState.revision, sources: { remoteRef: digest(resolvedRef) } },
    repositoryIds: [input.repositoryId],
    request: { configPath: input.configPath, plansDirectory: loaded.config.document.plans.directory, repositoryId: input.repositoryId, remote, requestedRef, resolved: resolvedRef as unknown as Json, destination: input.destination, stagingPath, operationId, workspaceId: id, localStateChange: { currentRevision: loaded.localState.revision, nextRevision } },
    actions: [
      { id: "clone-to-staging", type: "git-clone", path: stagingPath },
      { id: "publish-destination", type: "directory-publish", path: input.destination },
      { id: "write-local-state", type: "document-cas", target: "local-state", path: loaded.config.document.localState.path, expectedRevision: loaded.localState.revision, nextRevision },
    ],
    preconditions: [
      { id: "config-current", type: "revision", target: "config", expected: loaded.config.revision },
      { id: "catalog-current", type: "revision", target: "catalog", expected: loaded.catalog.revision },
      { id: "local-state-current", type: "revision", target: "local-state", expected: loaded.localState.revision },
      { id: "destination-absent", type: "revision", target: "destination", expected: ABSENT_REVISION },
      { id: "staging-absent", type: "revision", target: "staging", expected: ABSENT_REVISION },
      { id: "remote-ref", type: "source-digest", target: "remote-ref", expected: resolvedRef.commit },
    ],
    expectedOutputs: [{ id: "local-state-edited", type: "document", target: "local-state", revision: nextRevision }],
    approvalsRequired: [{ id: "apply", kind: "explicit-plan-id" }],
  });
}

export async function createCheckoutPlan(input: CheckoutRequest, createdAt = new Date().toISOString()): Promise<WorkspacePlan> {
  return deriveCheckoutPlan(input, createdAt, true);
}

function operationPath(plansDirectory: string, operationId: string): string {
  requireThat(/^operation-[a-f0-9]{24}$/.test(operationId), "INVALID_CONFIG");
  return join(plansDirectory, "operations", `${operationId}.json`);
}

async function writeOperation(plansDirectory: string, operation: CheckoutOperation): Promise<void> {
  operation = validateCheckoutOperation(operation);
  const directory = join(plansDirectory, "operations");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await requireStablePath(directory);
  const target = operationPath(plansDirectory, operation.id);
  const temporary = join(directory, `.${operation.id}.${process.pid}.${createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 8)}.tmp`);
  await writeFile(temporary, JSON.stringify(operation, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await rename(temporary, target);
}

async function readOperation(plansDirectory: string, operationId: string): Promise<CheckoutOperation> {
  const path = operationPath(plansDirectory, operationId);
  await requireStablePath(path);
  const status = await lstat(path);
  requireThat(status.isFile() && !status.isSymbolicLink() && status.size <= 256 * 1024, "INVALID_CONFIG");
  const value = validateCheckoutOperation(parseDataText(await readFile(path, "utf8"), "json", 256 * 1024));
  requireThat(value.id === operationId, "INVALID_CONFIG");
  return value;
}

function operationFromPlan(plan: WorkspacePlan, status: CheckoutOperation["status"], outcome: string | null): CheckoutOperation {
  const request = plan.request as any;
  return { format: "workspacectl-operation/1", id: request.operationId, kind: "checkout", planId: plan.id, planDigest: plan.semanticDigest, configPath: request.configPath, repositoryId: request.repositoryId, remote: request.remote, requestedRef: request.requestedRef, resolved: request.resolved, destination: request.destination, stagingPath: request.stagingPath, workspaceId: request.workspaceId, status, outcome, updatedAt: new Date().toISOString() };
}

async function observeExactCheckout(operation: CheckoutOperation): Promise<{ present: boolean; valid: boolean; reason: string; branch: string | null }> {
  try {
    await requireStablePath(operation.destination);
    const status = await lstat(operation.destination);
    if (!status.isDirectory() || status.isSymbolicLink()) return { present: true, valid: false, reason: "destination is not a real directory", branch: null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error instanceof GovernanceError && error.code === "INVALID_CONFIG")) return { present: false, valid: false, reason: "destination absent", branch: null };
    throw error;
  }
  const origin = await runGit(["config", "--get", "remote.origin.url"], { cwd: operation.destination, allowFailure: true });
  const head = await runGit(["rev-parse", "HEAD"], { cwd: operation.destination, allowFailure: true });
  const symbolic = await runGit(["symbolic-ref", "--short", "HEAD"], { cwd: operation.destination, allowFailure: true });
  const worktree = await runGit(["status", "--porcelain=v1", "--untracked-files=all"], { cwd: operation.destination, allowFailure: true });
  let remoteMatches = false;
  try { remoteMatches = origin.code === 0 && canonicalRemote(origin.stdout.trim()) === operation.remote; } catch { remoteMatches = false; }
  const branch = symbolic.code === 0 ? symbolic.stdout.trim() : null;
  const expectedBranch = operation.resolved.kind === "branch" ? operation.resolved.name : null;
  const identityValid = remoteMatches && head.code === 0 && head.stdout.trim() === operation.resolved.commit && branch === expectedBranch;
  const clean = worktree.code === 0 && worktree.stdout.length === 0;
  const complete = clean && await matchesCompleteCheckout(operation.destination, operation.resolved.commit);
  const materialized = complete && !(await containsLfsPointer(operation.destination));
  const valid = identityValid && materialized;
  const reason = valid ? "verified" : !identityValid ? "origin, ref, or attachment mismatch" : !complete ? "checkout has dirty or incomplete content" : "Git LFS content remains a pointer";
  return { present: true, valid, reason, branch };
}

function regularTrackedFiles(output: string): string[] {
  return output.split("\0").filter(Boolean).flatMap((entry) => {
    const separator = entry.indexOf("\t");
    if (separator < 0) return [];
    const mode = entry.slice(0, separator).split(" ", 1)[0];
    return mode === "100644" || mode === "100755" ? [entry.slice(separator + 1)] : [];
  });
}

async function matchesCompleteCheckout(path: string, commit: string): Promise<boolean> {
  const temporary = await mkdtemp(join(tmpdir(), "workspacectl-checkout-index-"));
  const index = join(temporary, "index");
  const env = { GIT_INDEX_FILE: index };
  try {
    const readTree = await runGit(["read-tree", "--reset", commit], { cwd: path, allowFailure: true, env });
    if (readTree.code !== 0) return false;
    const tracked = await runGit(["ls-files", "--stage", "-z"], { cwd: path, allowFailure: true, env });
    if (tracked.code !== 0) return false;
    for (const relative of regularTrackedFiles(tracked.stdout)) {
      try {
        const handle = await open(join(path, relative), "r");
        try { await handle.read(Buffer.alloc(1), 0, 1, 0); }
        finally { await handle.close(); }
      } catch { return false; }
    }
    const refreshed = await runGit(["update-index", "--refresh", "--ignore-submodules"], { cwd: path, allowFailure: true, env });
    if (refreshed.code !== 0) return false;
    const compared = await runGit(["diff-files", "--quiet", "--no-ext-diff", "--ignore-submodules=all", "--"], { cwd: path, allowFailure: true, env });
    return compared.code === 0;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function containsLfsPointer(path: string): Promise<boolean> {
  const files = await runGit(["ls-files", "--stage", "-z"], { cwd: path });
  for (const relative of regularTrackedFiles(files.stdout)) {
    try {
      const handle = await open(join(path, relative), "r");
      try {
        const buffer = Buffer.alloc(256); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (buffer.subarray(0, bytesRead).toString("utf8").startsWith("version https://git-lfs.github.com/spec/v1\n")) return true;
      } finally { await handle.close(); }
    } catch { return true; }
  }
  return false;
}

async function currentReadback(loaded: Loaded) {
  return { revisions: { config: loaded.config.revision, catalog: loaded.catalog.revision, localState: loaded.localState.revision }, readback: { config: loaded.config.document, catalog: loaded.catalog.document, localState: loaded.localState.document } };
}

export async function applyCheckoutPlan(plan: WorkspacePlan, selectedConfigPath: string): Promise<any> {
  const request = plan.request as any;
  requireThat(selectedConfigPath === request.configPath, "STALE_PLAN");
  const derived = await deriveCheckoutPlan({
    configPath: request.configPath,
    repositoryId: request.repositoryId,
    destination: request.destination,
    ref: request.requestedRef,
  }, plan.createdAt, false);
  requireThat(canonicalJson(workspacePlanSemanticFields(derived)) === canonicalJson(workspacePlanSemanticFields(plan)), "STALE_PLAN");
  const loaded = await loadRegistry(request.configPath);
  let existing: CheckoutOperation | null = null;
  try { existing = await readOperation(request.plansDirectory, request.operationId); } catch (error) { if (!(error instanceof GovernanceError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (existing?.status === "completed") {
    const observed = await observeExactCheckout(existing);
    const binding = loaded.localState.document.repositoryWorkspaces.find((workspace) => workspace.id === existing!.workspaceId && workspace.path === existing!.destination);
    requireThat(observed.valid && binding !== undefined, "STALE_PLAN");
    return { planId: plan.id, kind: "checkout", ...(await currentReadback(loaded)), operation: { ...existing, observation: observed } };
  }
  let operation = operationFromPlan(plan, "planned", null);
  await writeOperation(request.plansDirectory, operation);
  const fail = async (status: "failed" | "needs-attention", outcome: string, code: string): Promise<never> => {
    operation = { ...operation, status, outcome, updatedAt: new Date().toISOString() }; await writeOperation(request.plansDirectory, operation); throw new GovernanceError(code);
  };
  try {
    await pathAbsent(request.destination, "STALE_PLAN");
    try { await pathAbsent(request.stagingPath, "CONFLICT"); } catch { return await fail("needs-attention", "staging path already exists; preserved for inspection", "ACTION_FAILED"); }
    requireThat(loaded.config.revision === plan.inputRevisions.config && loaded.catalog.revision === plan.inputRevisions.catalog && loaded.localState.revision === plan.inputRevisions.localState, "STALE_PLAN");
    const currentRef = await resolveRemoteRef(request.remote, request.requestedRef);
    requireThat(canonicalJson(currentRef) === canonicalJson(request.resolved), "STALE_PLAN");
    operation = { ...operation, status: "running", outcome: null, updatedAt: new Date().toISOString() }; await writeOperation(request.plansDirectory, operation);
    await runGit(["-c", "core.hooksPath=/dev/null", "clone", "--no-checkout", "--no-recurse-submodules", "--origin", "origin", request.remote, request.stagingPath]);
    if (request.resolved.kind === "branch") await runGit(["-c", "core.hooksPath=/dev/null", "checkout", "-B", request.resolved.name, "--track", `origin/${request.resolved.name}`], { cwd: request.stagingPath });
    else await runGit(["-c", "core.hooksPath=/dev/null", "checkout", "--detach", request.resolved.commit], { cwd: request.stagingPath });
    const stagedOperation = { ...operation, destination: request.stagingPath };
    const observed = await observeExactCheckout(stagedOperation);
    if (!observed.valid) return await fail("needs-attention", observed.reason, "ACTION_FAILED");
    if (await containsLfsPointer(request.stagingPath)) return await fail("needs-attention", "Git LFS content remains a pointer; prerequisites or content are unavailable", "UNSUPPORTED");
    await pathAbsent(request.destination, "STALE_PLAN");
    await rename(request.stagingPath, request.destination);
    const afterPublish = await observeExactCheckout(operation);
    if (!afterPublish.valid) return await fail("needs-attention", afterPublish.reason, "ACTION_FAILED");
    const refreshed = await loadRegistry(request.configPath);
    if (refreshed.localState.revision !== plan.inputRevisions.localState) return await fail("needs-attention", "destination published but local state changed", "ACTION_FAILED");
    const next = nextStateForCheckout(refreshed, request);
    requireThat(documentRevision(next) === request.localStateChange.nextRevision, "STALE_PLAN");
    await writeLocalStateDocument(new FileLocalStateStore(refreshed.config.document.localState.path), refreshed.localState.revision, next);
    const final = await loadRegistry(request.configPath);
    const binding = final.localState.document.repositoryWorkspaces.find((workspace) => workspace.id === request.workspaceId && workspace.path === request.destination);
    requireThat(binding !== undefined && (await observeExactCheckout(operation)).valid, "ACTION_FAILED");
    operation = { ...operation, status: "completed", outcome: "checkout and binding verified", updatedAt: new Date().toISOString() }; await writeOperation(request.plansDirectory, operation);
    return { planId: plan.id, kind: "checkout", ...(await currentReadback(final)), operation };
  } catch (error) {
    if (error instanceof GovernanceError && ["STALE_PLAN", "ACTION_FAILED", "UNSUPPORTED"].includes(error.code)) {
      if (operation.status === "planned" || operation.status === "running") {
        let partial = false; try { await lstat(request.stagingPath); partial = true; } catch {}
        operation = { ...operation, status: partial ? "needs-attention" : "failed", outcome: partial ? "partial staging data preserved" : error.message, updatedAt: new Date().toISOString() };
        await writeOperation(request.plansDirectory, operation);
      }
      throw error;
    }
    let partial = false; try { await lstat(request.stagingPath); partial = true; } catch {}
    operation = { ...operation, status: partial ? "needs-attention" : "failed", outcome: partial ? "partial staging data preserved" : "checkout failed", updatedAt: new Date().toISOString() };
    await writeOperation(request.plansDirectory, operation);
    throw new GovernanceError("ACTION_FAILED");
  }
}

export async function showCheckoutOperation(configPath: string, operationId: string): Promise<{ operation: CheckoutOperation & { observation: any; stagingPresent: boolean; bindingPresent: boolean } }> {
  const loaded = await loadRegistry(configPath);
  const operation = await readOperation(loaded.config.document.plans.directory, operationId);
  requireThat(operation.configPath === configPath, "CONFLICT");
  const observation = await observeExactCheckout(operation);
  let stagingPresent = false; try { const status = await lstat(operation.stagingPath); stagingPresent = status.isDirectory() || status.isFile(); } catch {}
  const bindingPresent = loaded.localState.document.repositoryWorkspaces.some((workspace) => workspace.id === operation.workspaceId && workspace.path === operation.destination && workspace.repositoryId === operation.repositoryId);
  let status = operation.status;
  if (observation.valid && bindingPresent) status = "completed";
  else status = "needs-attention";
  return { operation: { ...operation, status, observation, stagingPresent, bindingPresent } };
}

export async function createCheckoutReconcilePlan(configPath: string, operationId: string, createdAt = new Date().toISOString()): Promise<WorkspacePlan> {
  const loaded = await loadRegistry(configPath);
  const shown = await showCheckoutOperation(configPath, operationId);
  const operation = shown.operation;
  requireThat(operation.observation.valid && !operation.stagingPresent && !operation.bindingPresent, "UNSUPPORTED");
  const next = nextStateForCheckout(loaded, { repositoryId: operation.repositoryId, destination: operation.destination, workspaceId: operation.workspaceId, resolved: operation.resolved });
  const nextRevision = documentRevision(next);
  return finishPlan({
    schemaVersion: 2, format: "workspacectl-plan/1", kind: "checkout-reconcile", createdAt,
    inputRevisions: { config: loaded.config.revision, catalog: loaded.catalog.revision, localState: loaded.localState.revision, sources: { operation: operation.planDigest, remoteRef: digest(operation.resolved) } },
    repositoryIds: [operation.repositoryId],
    request: { configPath, plansDirectory: loaded.config.document.plans.directory, operationId, repositoryId: operation.repositoryId, remote: operation.remote, destination: operation.destination, stagingPath: operation.stagingPath, workspaceId: operation.workspaceId, resolved: operation.resolved as unknown as Json, localStateChange: { currentRevision: loaded.localState.revision, nextRevision } },
    actions: [{ id: "write-local-state", type: "document-cas", target: "local-state", path: loaded.config.document.localState.path, expectedRevision: loaded.localState.revision, nextRevision }],
    preconditions: [{ id: "operation-current", type: "source-digest", target: "operation", expected: operation.planDigest }, { id: "destination-verified", type: "source-digest", target: "remote-ref", expected: operation.resolved.commit }],
    expectedOutputs: [{ id: "local-state-edited", type: "document", target: "local-state", revision: nextRevision }], approvalsRequired: [{ id: "apply", kind: "explicit-plan-id" }],
  });
}

export async function applyCheckoutReconcilePlan(plan: WorkspacePlan, selectedConfigPath: string): Promise<any> {
  const request = plan.request as any;
  requireThat(selectedConfigPath === request.configPath, "STALE_PLAN");
  const derived = await createCheckoutReconcilePlan(request.configPath, request.operationId, plan.createdAt);
  requireThat(canonicalJson(workspacePlanSemanticFields(derived)) === canonicalJson(workspacePlanSemanticFields(plan)), "STALE_PLAN");
  const loaded = await loadRegistry(request.configPath);
  const operation = await readOperation(request.plansDirectory, request.operationId);
  const next = nextStateForCheckout(loaded, request);
  await writeLocalStateDocument(new FileLocalStateStore(loaded.config.document.localState.path), loaded.localState.revision, next);
  const final = await loadRegistry(request.configPath);
  const completed = { ...operation, status: "completed" as const, outcome: "verified existing checkout binding repaired", updatedAt: new Date().toISOString() };
  await writeOperation(request.plansDirectory, completed);
  return { planId: plan.id, kind: "checkout-reconcile", ...(await currentReadback(final)), operation: completed };
}
