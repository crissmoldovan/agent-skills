import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { canonicalJson, canonicalRemote, GovernanceError, requireThat } from "./core.ts";
import type { Json } from "./core.ts";
import { readSelectedRegistry } from "./catalog-readback.ts";
import { reopenCoordinationWorkspace } from "./coordination.ts";
import { resolveProjectContexts } from "./relevant-context.ts";
import { resolveCatalogContext } from "./v2-context.ts";
import type { ResolvedCatalogContext } from "./v2-context.ts";

export type WorkflowRunStatus = "ready" | "running" | "waiting-for-agent" | "waiting-for-approval" | "failed" | "interrupted" | "completed";
export interface WorkflowHandoff {
  runId: string; stepId: string; attemptId: string; requestDigest: string;
  kind: "agent.task" | "external.action" | "command"; target: string; objective: string;
  expectedOutputs: Json[]; verification: Json[];
  repositoryId?: string; workspaceId?: string; workspacePath?: string;
  context?: { sharedProjectContext: Json; repositoryContext: Json };
}
interface RunStep { id: string; type: string; status: "pending" | "running" | "waiting" | "claimed" | "completed" | "failed" | "ambiguous"; attemptId: string | null; attempts: number; history: Json[]; outcome: Json | null }
export interface WorkflowRun {
  format: "workspacectl-run/1"; id: string; workflowId: string; repositoryId: string; workspaceId: string;
  status: WorkflowRunStatus; inputs: Record<string, string>; inputFingerprint: string; definitionDigest: string;
  actionFingerprints: Record<string, string>; workspaceFingerprint: string; revisions: { config: string; catalog: string; localState: string }; workspacePath: string;
  steps: RunStep[]; pending: WorkflowHandoff | null; approvals: string[]; createdAt: string; updatedAt: string;
  coordinationWorkspaceId?: string;
  coordinationRevision?: string;
  members?: Array<{ repositoryId: string; workspaceId: string; path: string; fingerprint: string }>;
  projectContexts?: { sharedProjectContext: Json; repositoryContexts: Json[] };
  validity?: "current" | "stale"; blockers?: string[];
}
type ResolvedWorkflow = NonNullable<ResolvedCatalogContext["workflow"]>;

const allowedActions = new Set(["coordination.check", "context.resolve", "workspace.check", "agent.task", "command", "verify", "external.action", "rules.distribute"]);
const plain = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value as Json)).digest("hex");
const newId = (prefix: string) => `${prefix}-${randomBytes(12).toString("hex")}`;
function exactKeys(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, any> { requireThat(plain(value) && required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key)), "INVALID_CONFIG"); }
function boundedText(value: unknown): asserts value is string { requireThat(typeof value === "string" && value.length > 0 && value.length <= 16_384 && !/[\0\r\n]/.test(value), "INVALID_CONFIG"); }
function relativeFile(value: unknown): asserts value is string { boundedText(value); requireThat(!value.startsWith("/") && !value.split("/").some((part) => part === "" || part === "." || part === ".."), "INVALID_CONFIG"); }
function validateVerification(value: unknown): Json[] {
  requireThat(Array.isArray(value) && value.length > 0 && value.length <= 100, "INVALID_CONFIG");
  for (const check of value) {
    exactKeys(check, ["type", "path"], ["content", "sha256", "fields", "outputId"]); requireThat(["file", "json-file"].includes(check.type), "INVALID_CONFIG"); relativeFile(check.path); if (Object.hasOwn(check, "outputId")) boundedText(check.outputId);
    requireThat(["content", "sha256", "fields"].filter((key) => Object.hasOwn(check, key)).length === 1, "INVALID_CONFIG");
    if (Object.hasOwn(check, "content")) requireThat(typeof check.content === "string" && check.content.length <= 2 * 1024 * 1024, "INVALID_CONFIG");
    if (Object.hasOwn(check, "sha256")) requireThat(typeof check.sha256 === "string" && /^[a-f0-9]{64}$/.test(check.sha256), "INVALID_CONFIG");
    if (Object.hasOwn(check, "fields")) requireThat(plain(check.fields) && Object.keys(check.fields).length > 0, "INVALID_CONFIG");
  }
  return structuredClone(value) as Json[];
}
function hasTypedExternalHandle(check: Record<string, any>): boolean {
  if (check.type !== "json-file" || !plain(check.fields)) return false;
  let handles = 0;
  if (Object.hasOwn(check.fields, "url")) {
    handles += 1;
    requireThat(typeof check.fields.url === "string" && check.fields.url.length <= 2_048, "INVALID_CONFIG");
    let parsed: URL;
    try { parsed = new URL(check.fields.url); } catch { throw new GovernanceError("INVALID_CONFIG"); }
    requireThat(["http:", "https:"].includes(parsed.protocol) && parsed.hostname.length > 0 && parsed.username === "" && parsed.password === "", "INVALID_CONFIG");
  }
  if (Object.hasOwn(check.fields, "id")) {
    handles += 1;
    requireThat(typeof check.fields.id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(check.fields.id), "INVALID_CONFIG");
  }
  if (Object.hasOwn(check.fields, "commit")) {
    handles += 1;
    requireThat(typeof check.fields.commit === "string" && /^[a-fA-F0-9]{7,64}$/.test(check.fields.commit), "INVALID_CONFIG");
  }
  return handles > 0;
}
function validateOutputs(value: unknown): Json[] { requireThat(Array.isArray(value) && value.length > 0 && value.length <= 100, "INVALID_CONFIG"); for (const output of value) { exactKeys(output, ["id", "path"]); boundedText(output.id); relativeFile(output.path); } return structuredClone(value) as Json[]; }
function validateStepTarget(c: Record<string, any>, optional = true): void {
  const present = Object.hasOwn(c, "repositoryId") || Object.hasOwn(c, "workspaceId");
  requireThat(optional || present, "INVALID_CONFIG");
  requireThat(!present || (Object.hasOwn(c, "repositoryId") && Object.hasOwn(c, "workspaceId")), "INVALID_CONFIG");
  if (present) { boundedText(c.repositoryId); boundedText(c.workspaceId); }
}
function validateExecutableWorkflow(workflow: ResolvedWorkflow): void {
  requireThat(workflow.steps.length > 0, "INVALID_CONFIG");
  for (const step of workflow.steps) {
    requireThat(allowedActions.has(step.type), "UNSUPPORTED"); const c = step.configuration;
    if (step.type === "coordination.check") { exactKeys(c, ["coordinationWorkspaceId", "memberWorkspaceIds"]); boundedText(c.coordinationWorkspaceId); requireThat(Array.isArray(c.memberWorkspaceIds) && c.memberWorkspaceIds.length > 1 && new Set(c.memberWorkspaceIds).size === c.memberWorkspaceIds.length, "INVALID_CONFIG"); c.memberWorkspaceIds.forEach(boundedText); requireThat(step.sideEffect === "none" && step.approval === "none", "INVALID_CONFIG"); }
    if (step.type === "context.resolve" || step.type === "workspace.check") { exactKeys(c, ["repositoryId", "workspaceId"]); validateStepTarget(c, false); requireThat(step.sideEffect === "none" && step.approval === "none", "INVALID_CONFIG"); }
    if (step.type === "agent.task" || step.type === "external.action") { exactKeys(c, ["target", "objective", "expectedOutputs", "verification"], ["repositoryId", "workspaceId"]); validateStepTarget(c); boundedText(c.target); boundedText(c.objective); const outputs = validateOutputs(c.expectedOutputs) as any[], verification = validateVerification(c.verification) as any[]; requireThat(outputs.every((output) => verification.some((check) => check.path === output.path)), "INVALID_CONFIG"); if (step.type === "external.action") requireThat(verification.some((check) => outputs.some((output) => output.path === check.path) && hasTypedExternalHandle(check)) && step.sideEffect === "external" && step.approval === "explicit", "INVALID_CONFIG"); else requireThat(step.sideEffect === "none" && step.approval === "none", "INVALID_CONFIG"); }
    if (step.type === "command") {
      exactKeys(c, ["executable", "argv", "cwd", "environment", "timeoutMs", "expectedExit"], ["repositoryId", "workspaceId"]); validateStepTarget(c); boundedText(c.executable); requireThat(resolve(c.executable) === c.executable, "INVALID_CONFIG");
      requireThat(Array.isArray(c.argv) && c.argv.length <= 100 && c.argv.every((entry: unknown) => typeof entry === "string" && entry.length <= 16_384 && !entry.includes("\0")), "INVALID_CONFIG");
      requireThat(c.cwd === "workspace" && Array.isArray(c.environment) && new Set(c.environment).size === c.environment.length && c.environment.every((entry: unknown) => typeof entry === "string" && /^[A-Z_][A-Z0-9_]*$/.test(entry)), "INVALID_CONFIG");
      requireThat(typeof c.timeoutMs === "number" && Number.isInteger(c.timeoutMs) && c.timeoutMs >= 1 && c.timeoutMs <= 600_000 && typeof c.expectedExit === "number" && Number.isInteger(c.expectedExit) && c.expectedExit >= 0 && c.expectedExit <= 255 && step.approval === "explicit", "INVALID_CONFIG");
    }
    if (step.type === "verify") { exactKeys(c, ["checks"], ["repositoryId", "workspaceId"]); validateStepTarget(c); validateVerification(c.checks); requireThat(step.sideEffect === "none" && step.approval === "none", "INVALID_CONFIG"); }
    if (step.type === "rules.distribute") {
      exactKeys(c, ["outputId", "source", "repositories"]); boundedText(c.outputId);
      const source = c.source as any; exactKeys(source, ["repositoryId", "path", "revision", "contentDigest"]); boundedText(source.repositoryId); boundedText(source.revision); requireThat(resolve(source.path) === source.path && /^[a-f0-9]{64}$/.test(source.contentDigest), "INVALID_CONFIG");
      requireThat(Array.isArray(c.repositories) && c.repositories.length > 0 && c.repositories.length <= 100, "INVALID_CONFIG");
      const repositories = new Set<string>(), workspaces = new Set<string>(), reviewTargets = new Set<string>();
      for (const raw of c.repositories) {
        requireThat(plain(raw), "INVALID_CONFIG"); const item = raw as any;
        if (item.status === "not-carrying") exactKeys(item, ["repositoryId", "workspaceId", "status"]);
        else { exactKeys(item, ["repositoryId", "workspaceId", "status", "carryingPath", "reviewTarget"]); requireThat(item.status === "carrying", "INVALID_CONFIG"); relativeFile(item.carryingPath); boundedText(item.reviewTarget); let review: URL; try { review = new URL(item.reviewTarget); } catch { throw new GovernanceError("INVALID_CONFIG"); } requireThat(review.protocol === "review:" && review.hostname === item.repositoryId && review.username === "" && review.password === "" && review.search === "" && review.hash === "" && !reviewTargets.has(item.reviewTarget), "INVALID_CONFIG"); reviewTargets.add(item.reviewTarget); }
        boundedText(item.repositoryId); boundedText(item.workspaceId); requireThat(!repositories.has(item.repositoryId) && !workspaces.has(item.workspaceId), "INVALID_CONFIG"); repositories.add(item.repositoryId); workspaces.add(item.workspaceId);
      }
      requireThat(c.repositories.some((item: any) => item.status === "carrying") && c.repositories.some((item: any) => item.status === "not-carrying") && step.sideEffect === "none" && step.approval === "none", "INVALID_CONFIG");
    }
  }
  for (const step of workflow.steps.filter((entry) => entry.type === "command")) {
    requireThat(workflow.steps.some((entry) => entry.type === "verify" && entry.needs.includes(step.id)), "INVALID_CONFIG");
  }
  const verifiedOutputIds = new Set<string>();
  for (const step of workflow.steps) {
    const c = step.configuration as any;
    if (step.type === "agent.task" || step.type === "external.action") for (const output of c.expectedOutputs) verifiedOutputIds.add(output.id);
    if (step.type === "verify") for (const check of c.checks) if (check.outputId !== undefined) verifiedOutputIds.add(check.outputId);
    if (step.type === "rules.distribute") verifiedOutputIds.add(c.outputId);
  }
  requireThat(workflow.outputs.filter((output) => output.required).every((output) => verifiedOutputIds.has(output.id)), "INVALID_CONFIG");
}
async function selected(configPath: string, repositoryId: string, workspaceId: string, workflowId: string) {
  const registry = await readSelectedRegistry(configPath), workspace = registry.localState.repositoryWorkspaces.find((entry) => entry.id === workspaceId && entry.repositoryId === repositoryId); requireThat(workspace !== undefined, "NOT_FOUND");
  const context = resolveCatalogContext(registry.catalog, registry.localState, { repositoryId, workspaceId, workflowId }); requireThat(context.workflow !== null, "NOT_FOUND"); validateExecutableWorkflow(context.workflow);
  return { registry, workspace, workflow: context.workflow, definitionDigest: hash(context.workflow) };
}
async function selectedCoordination(configPath: string, coordinationWorkspaceId: string, workflowId: string) {
  const registry = await readSelectedRegistry(configPath);
  const binding = registry.localState.coordinationWorkspaces.find((entry) => entry.id === coordinationWorkspaceId);
  requireThat(binding !== undefined && binding.scope.kind === "project" && binding.memberRepositoryIds.length === 2, "INVALID_CONFIG");
  const readback = await reopenCoordinationWorkspace(configPath, coordinationWorkspaceId);
  requireThat(readback.status === "exact" && readback.members.length === 2 && readback.members.every((member) => member.path !== null), "STALE_PLAN");
  const anchor = await selected(configPath, readback.members[0].repositoryId, readback.members[0].workspaceId, workflowId);
  const members = readback.members.map((member) => ({ repositoryId: member.repositoryId, workspaceId: member.workspaceId, path: member.path! }));
  const memberKeys = new Set(members.map((member) => `${member.repositoryId}\0${member.workspaceId}`));
  const coordinationStep = anchor.workflow.steps.find((step) => step.type === "coordination.check");
  requireThat(coordinationStep !== undefined && coordinationStep.configuration.coordinationWorkspaceId === coordinationWorkspaceId && canonicalJson(coordinationStep.configuration.memberWorkspaceIds as Json) === canonicalJson(binding.memberWorkspaceIds as Json), "INVALID_CONFIG");
  for (const step of anchor.workflow.steps) {
    const c = step.configuration as any;
    if (["context.resolve", "workspace.check", "agent.task", "command", "verify", "external.action"].includes(step.type)) requireThat(typeof c.repositoryId === "string" && typeof c.workspaceId === "string" && memberKeys.has(`${c.repositoryId}\0${c.workspaceId}`), "INVALID_CONFIG");
    if (step.type === "rules.distribute") requireThat(canonicalJson(c.repositories.map((item: any) => `${item.repositoryId}\0${item.workspaceId}`).sort()) === canonicalJson([...memberKeys].sort()), "INVALID_CONFIG");
  }
  for (const member of members) requireThat(anchor.workflow.steps.some((step) => step.type === "context.resolve" && step.configuration.repositoryId === member.repositoryId && step.configuration.workspaceId === member.workspaceId), "INVALID_CONFIG");
  const contexts = await resolveProjectContexts(registry.catalog, registry.localState, { projectId: binding.scope.id, repositoryIds: binding.memberRepositoryIds, workspaceIds: Object.fromEntries(members.map((member) => [member.repositoryId, member.workspaceId])), workflowId, catalogPath: registry.config.catalog.path, trustedRoots: registry.config.trustedRoots });
  return { registry, binding, readback, members, workflow: anchor.workflow, definitionDigest: anchor.definitionDigest, contexts };
}
async function commandFingerprints(workflow: ResolvedWorkflow): Promise<Record<string, string>> {
  const result: Record<string, string> = Object.create(null);
  for (const step of workflow.steps.filter((entry) => entry.type === "command")) {
    const c = step.configuration as any, files: Array<{ path: string; digest: string }> = [];
    for (const path of [c.executable, ...c.argv.filter((entry: string) => resolve(entry) === entry)]) { const status = await lstat(path); requireThat(status.isFile() && !status.isSymbolicLink() && status.size <= 256 * 1024 * 1024, "UNAVAILABLE"); files.push({ path, digest: createHash("sha256").update(await readFile(path)).digest("hex") }); }
    result[step.id] = hash(files);
  }
  return result;
}
async function observeWorkspaceFingerprint(path: string, expectedRemote: string): Promise<string> {
  requireThat(await realpath(path) === path, "UNAVAILABLE");
  const run = (args: string[]) => spawnSync("git", args, { cwd: path, encoding: "utf8", timeout: 10_000 });
  const top = run(["rev-parse", "--show-toplevel"]), common = run(["rev-parse", "--path-format=absolute", "--git-common-dir"]), remote = run(["remote", "get-url", "origin"]);
  requireThat([top, common, remote].every((entry) => entry.status === 0) && top.stdout.trim() === path && canonicalRemote(remote.stdout.trim()) === canonicalRemote(expectedRemote), "UNAVAILABLE");
  const commonDir = await realpath(common.stdout.trim()), [rootIdentity, gitIdentity] = await Promise.all([stat(path), stat(commonDir)]);
  return hash({ path, rootDevice: rootIdentity.dev, rootInode: rootIdentity.ino, commonDir, gitDevice: gitIdentity.dev, gitInode: gitIdentity.ino, remote: canonicalRemote(expectedRemote) });
}
export async function listExecutableWorkflows(configPath: string, repositoryId: string, workspaceId: string) {
  const registry = await readSelectedRegistry(configPath); requireThat(registry.localState.repositoryWorkspaces.some((entry) => entry.id === workspaceId && entry.repositoryId === repositoryId), "NOT_FOUND");
  const ids = [...new Set([...registry.catalog.workflows, ...(registry.localState.workspaceWorkflowOverlays ?? [])].map((entry) => entry.id))].sort();
  return { revisions: registry.revisions, workflows: ids.flatMap((workflowId) => { try { const workflow = resolveCatalogContext(registry.catalog, registry.localState, { repositoryId, workspaceId, workflowId }).workflow; if (!workflow) return []; validateExecutableWorkflow(workflow); return [{ id: workflow.id, inputs: workflow.inputs, outputs: workflow.outputs, steps: workflow.steps.length }]; } catch { return []; } }) };
}
export async function showExecutableWorkflow(configPath: string, repositoryId: string, workspaceId: string, workflowId: string) { const value = await selected(configPath, repositoryId, workspaceId, workflowId); return { revisions: value.registry.revisions, definitionDigest: value.definitionDigest, workflow: { ...value.workflow, executable: true } }; }
export async function showExecutableCoordinationWorkflow(configPath: string, coordinationWorkspaceId: string, workflowId: string) { const value = await selectedCoordination(configPath, coordinationWorkspaceId, workflowId); return { revisions: value.registry.revisions, definitionDigest: value.definitionDigest, coordination: value.readback, workflow: { ...value.workflow, executable: true } }; }
const runsDir = (config: { plans: { directory: string } }) => join(config.plans.directory, "runs");
async function withRunLock<T>(configPath: string, runId: string, action: () => Promise<T>): Promise<T> {
  requireThat(/^run-[a-f0-9]{24}$/.test(runId), "INVALID_CONFIG");
  const registry = await readSelectedRegistry(configPath), directory = resolve(runsDir(registry.config));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStatus = await lstat(directory);
  requireThat(directoryStatus.isDirectory() && !directoryStatus.isSymbolicLink() && await realpath(directory) === directory, "UNAVAILABLE");
  const lockPath = join(directory, `${runId}.lock`);
  requireThat(dirname(lockPath) === directory, "INVALID_CONFIG");
  const lockText = JSON.stringify({ schemaVersion: 1, runId, nonce: randomBytes(16).toString("hex"), pid: process.pid, createdAt: new Date().toISOString() }) + "\n";
  let handle;
  try {
    try { handle = await open(lockPath, "wx", 0o600); }
    catch (error: any) { if (error?.code === "EEXIST") throw new GovernanceError("BUSY"); throw new GovernanceError("ACTION_FAILED"); }
    await handle.writeFile(lockText); await handle.sync();
    return await action();
  } finally {
    if (handle) {
      const identity = await handle.stat().catch(() => null); await handle.close().catch(() => undefined);
      try {
        const current = await lstat(lockPath);
        if (identity && current.isFile() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino && await readFile(lockPath, "utf8") === lockText) await unlink(lockPath);
      } catch (error: any) { if (error?.code !== "ENOENT") { /* Unknown or replaced locks are preserved. */ } }
    }
  }
}
async function writeExclusiveAtomic(path: string, value: unknown, replaceExisting: boolean) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.tmp-${randomBytes(8).toString("hex")}`; let handle;
  try { handle = await open(temporary, "wx", 0o600); await handle.writeFile(JSON.stringify(value, null, 2) + "\n"); await handle.sync(); await handle.close(); handle = undefined; if (!replaceExisting) { try { await lstat(path); throw new GovernanceError("CONFLICT"); } catch (error: any) { if (error instanceof GovernanceError || error?.code !== "ENOENT") throw error; } } await rename(temporary, path); } finally { await handle?.close(); await rm(temporary, { force: true }); }
}
const saveRun = async (config: { plans: { directory: string } }, run: WorkflowRun, fresh = false) => writeExclusiveAtomic(join(runsDir(config), `${run.id}.json`), run, !fresh);
function targetFor(run: WorkflowRun, configuration: Record<string, any>): { repositoryId: string; workspaceId: string; path: string } {
  if (run.members) {
    const member = run.members.find((entry) => entry.repositoryId === configuration.repositoryId && entry.workspaceId === configuration.workspaceId);
    requireThat(member !== undefined, "INVALID_CONFIG"); return member;
  }
  requireThat((configuration.repositoryId === undefined || configuration.repositoryId === run.repositoryId) && (configuration.workspaceId === undefined || configuration.workspaceId === run.workspaceId), "INVALID_CONFIG");
  return { repositoryId: run.repositoryId, workspaceId: run.workspaceId, path: run.workspacePath };
}
function contextFor(run: WorkflowRun, repositoryId: string): WorkflowHandoff["context"] | undefined {
  if (!run.projectContexts) return undefined;
  const repositoryContext = run.projectContexts.repositoryContexts.find((entry: any) => entry.repositoryId === repositoryId);
  requireThat(repositoryContext !== undefined, "INVALID_CONFIG");
  return { sharedProjectContext: run.projectContexts.sharedProjectContext, repositoryContext };
}
function pendingFor(run: WorkflowRun, step: ResolvedWorkflow["steps"][number], attemptId: string): WorkflowHandoff {
  const c = step.configuration as any, targetBinding = targetFor(run, c), context = contextFor(run, targetBinding.repositoryId);
  const targetFields = run.members === undefined ? {} : { repositoryId: targetBinding.repositoryId, workspaceId: targetBinding.workspaceId, workspacePath: targetBinding.path, ...(context === undefined ? {} : { context }) };
  const base = step.type === "command"
    ? { runId: run.id, stepId: step.id, attemptId, kind: "command" as const, target: c.executable, objective: `Execute approved argv in ${targetBinding.path}`, expectedOutputs: [] as Json[], verification: [{ executable: c.executable, argv: c.argv, cwd: targetBinding.path, environment: c.environment, timeoutMs: c.timeoutMs, expectedExit: c.expectedExit }] as Json[], ...targetFields }
    : { runId: run.id, stepId: step.id, attemptId, kind: step.type as "agent.task" | "external.action", target: c.target, objective: c.objective, expectedOutputs: validateOutputs(c.expectedOutputs), verification: validateVerification(c.verification), ...targetFields };
  return { ...base, requestDigest: hash(base) };
}
function beginAttempt(run: WorkflowRun, step: ResolvedWorkflow["steps"][number]): void {
  const state = run.steps.find((entry) => entry.id === step.id)!;
  const attemptId = newId("attempt");
  state.attempts = (state.attempts ?? 0) + 1;
  state.attemptId = attemptId;
  state.status = "waiting";
  run.pending = pendingFor(run, step, attemptId);
  run.status = step.type === "agent.task" ? "waiting-for-agent" : "waiting-for-approval";
}
async function verifyChecks(workspacePath: string, checks: Json[]): Promise<Array<{ path: string; digest: string }>> {
  const root = await realpath(workspacePath), results = [];
  for (const raw of checks) {
    const check = raw as any, path = resolve(root, check.path); requireThat(path.startsWith(root + sep), "INVALID_CONFIG");
    let status;
    try { status = await lstat(path); } catch { throw new GovernanceError("INCOMPLETE"); }
    let canonicalPath;
    try { canonicalPath = await realpath(path); } catch { throw new GovernanceError("INCOMPLETE"); }
    requireThat(status.isFile() && !status.isSymbolicLink() && status.size <= 2 * 1024 * 1024 && canonicalPath === path, "UNAVAILABLE");
    const bytes = await readFile(path), digest = createHash("sha256").update(bytes).digest("hex");
    if (Object.hasOwn(check, "content")) requireThat(bytes.toString("utf8") === check.content, "INCOMPLETE");
    if (Object.hasOwn(check, "sha256")) requireThat(digest === check.sha256, "INCOMPLETE");
    if (Object.hasOwn(check, "fields")) { let parsed; try { parsed = JSON.parse(bytes.toString("utf8")); } catch { throw new GovernanceError("INCOMPLETE"); } requireThat(plain(parsed), "INCOMPLETE"); for (const [key, expected] of Object.entries(check.fields)) requireThat(canonicalJson(parsed[key] as Json) === canonicalJson(expected as Json), "INCOMPLETE"); }
    results.push({ path: check.path, digest });
  }
  return results;
}
async function distributeRules(run: WorkflowRun, configuration: Record<string, any>) {
  const sourceStatus = await lstat(configuration.source.path), sourceReal = await realpath(configuration.source.path), sourceBytes = await readFile(configuration.source.path);
  requireThat(sourceStatus.isFile() && !sourceStatus.isSymbolicLink() && sourceStatus.size <= 2 * 1024 * 1024 && sourceReal === configuration.source.path && createHash("sha256").update(sourceBytes).digest("hex") === configuration.source.contentDigest, "STALE_PLAN");
  const repositories: Json[] = [], proposals: Json[] = [];
  for (const item of configuration.repositories) {
    const member = targetFor(run, item);
    if (item.status === "not-carrying") { repositories.push({ repositoryId: member.repositoryId, workspaceId: member.workspaceId, status: "not-carrying" }); continue; }
    const path = resolve(member.path, item.carryingPath); requireThat(path.startsWith(member.path + sep), "INVALID_CONFIG");
    const status = await lstat(path), canonicalPath = await realpath(path); requireThat(status.isFile() && !status.isSymbolicLink() && status.size <= 2 * 1024 * 1024 && canonicalPath === path, "UNAVAILABLE");
    const carryingCurrentDigest = createHash("sha256").update(await readFile(path)).digest("hex"); requireThat(carryingCurrentDigest !== configuration.source.contentDigest, "CONFLICT");
    const proposalBase = { kind: "rule-set.proposal", repositoryId: member.repositoryId, workspaceId: member.workspaceId, workspacePath: member.path, sourceRepositoryId: configuration.source.repositoryId, sourcePath: configuration.source.path, sourceRevision: configuration.source.revision, sourceContentDigest: configuration.source.contentDigest, carryingPath: item.carryingPath, carryingCurrentDigest, proposedContentDigest: configuration.source.contentDigest, reviewTarget: item.reviewTarget, status: "proposed", merged: false, applied: false };
    const proposal = { ...proposalBase, proposalDigest: hash(proposalBase) }; proposals.push(proposal); repositories.push({ repositoryId: member.repositoryId, workspaceId: member.workspaceId, status: "carrying", drift: true, proposalDigest: proposal.proposalDigest });
  }
  return { source: structuredClone(configuration.source), repositories, proposals };
}
async function execute(run: WorkflowRun, workflow: ResolvedWorkflow, config: { plans: { directory: string } }): Promise<WorkflowRun> {
  run.status = "running";
  while (true) {
    const next = workflow.steps.find((step) => run.steps.find((entry) => entry.id === step.id)!.status === "pending" && step.needs.every((dependency) => run.steps.find((entry) => entry.id === dependency)?.status === "completed"));
    if (!next) { requireThat(run.steps.every((step) => step.status === "completed"), "INVALID_CONFIG"); run.status = "completed"; run.updatedAt = new Date().toISOString(); await saveRun(config, run); return run; }
    const state = run.steps.find((entry) => entry.id === next.id)!; state.status = "running";
    if (next.type === "coordination.check") { requireThat(run.coordinationWorkspaceId === next.configuration.coordinationWorkspaceId && canonicalJson(run.members!.map((member) => member.workspaceId)) === canonicalJson(next.configuration.memberWorkspaceIds as Json), "STALE_PLAN"); state.status = "completed"; state.outcome = { coordinationWorkspaceId: run.coordinationWorkspaceId, members: run.members!.map(({ fingerprint: _fingerprint, ...member }) => member) }; }
    else if (next.type === "context.resolve") { const target = targetFor(run, next.configuration as any); state.status = "completed"; state.outcome = { repositoryId: target.repositoryId, workspaceId: target.workspaceId, path: target.path, definitionDigest: run.definitionDigest, context: contextFor(run, target.repositoryId) ?? null }; }
    else if (next.type === "workspace.check") { const target = targetFor(run, next.configuration as any); const observed = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: target.path, encoding: "utf8", timeout: 10_000 }); requireThat(observed.status === 0 && observed.stdout.trim() === target.path, "UNAVAILABLE"); state.status = "completed"; state.outcome = { repositoryId: target.repositoryId, workspaceId: target.workspaceId, path: target.path }; }
    else if (next.type === "verify") { const target = targetFor(run, next.configuration as any), verified = await verifyChecks(target.path, validateVerification((next.configuration as any).checks)); state.status = "completed"; state.outcome = { repositoryId: target.repositoryId, workspaceId: target.workspaceId, verified }; }
    else if (next.type === "rules.distribute") { state.outcome = await distributeRules(run, next.configuration as any) as any; state.status = "completed"; }
    else if (next.type === "agent.task" || next.type === "external.action" || next.type === "command") { beginAttempt(run, next); run.updatedAt = new Date().toISOString(); await saveRun(config, run); return run; }
    else throw new GovernanceError("UNSUPPORTED");
  }
}
export async function startWorkflow(configPath: string, request: { repositoryId: string; workspaceId: string; workflowId: string; inputs: Record<string, string> }): Promise<WorkflowRun> {
  const value = await selected(configPath, request.repositoryId, request.workspaceId, request.workflowId); for (const input of value.workflow.inputs) requireThat(!input.required || (typeof request.inputs[input.id] === "string" && request.inputs[input.id].length > 0), "INVALID_CONFIG"); requireThat(Object.keys(request.inputs).every((key) => value.workflow.inputs.some((entry) => entry.id === key)), "INVALID_CONFIG");
  const repository = value.registry.catalog.repositories.find((entry) => entry.id === request.repositoryId)!;
  const now = new Date().toISOString(), run: WorkflowRun = { format: "workspacectl-run/1", id: newId("run"), workflowId: request.workflowId, repositoryId: request.repositoryId, workspaceId: request.workspaceId, status: "ready", inputs: structuredClone(request.inputs), inputFingerprint: hash(request.inputs), definitionDigest: value.definitionDigest, actionFingerprints: await commandFingerprints(value.workflow), workspaceFingerprint: await observeWorkspaceFingerprint(value.workspace.path, repository.remote), revisions: value.registry.revisions, workspacePath: value.workspace.path, steps: value.workflow.steps.map((entry) => ({ id: entry.id, type: entry.type, status: "pending", attemptId: null, attempts: 0, history: [], outcome: null })), pending: null, approvals: [], createdAt: now, updatedAt: now };
  await saveRun(value.registry.config, run, true); return execute(run, value.workflow, value.registry.config);
}
export async function startCoordinationWorkflow(configPath: string, request: { coordinationWorkspaceId: string; workflowId: string; inputs: Record<string, string> }): Promise<WorkflowRun> {
  const value = await selectedCoordination(configPath, request.coordinationWorkspaceId, request.workflowId);
  for (const input of value.workflow.inputs) requireThat(!input.required || (typeof request.inputs[input.id] === "string" && request.inputs[input.id].length > 0), "INVALID_CONFIG"); requireThat(Object.keys(request.inputs).every((key) => value.workflow.inputs.some((entry) => entry.id === key)), "INVALID_CONFIG");
  const members = [];
  for (const member of value.members) {
    const repository = value.registry.catalog.repositories.find((entry) => entry.id === member.repositoryId)!;
    members.push({ ...member, fingerprint: await observeWorkspaceFingerprint(member.path, repository.remote) });
  }
  for (const step of value.workflow.steps.filter((entry) => entry.type === "rules.distribute")) {
    const c = step.configuration as any;
    requireThat(value.registry.config.trustedRoots.some((root) => c.source.path === root || c.source.path.startsWith(root + sep)), "UNTRUSTED_INPUT");
    const sourceStatus = await lstat(c.source.path), sourceReal = await realpath(c.source.path), sourceBytes = await readFile(c.source.path);
    requireThat(sourceStatus.isFile() && !sourceStatus.isSymbolicLink() && sourceStatus.size <= 2 * 1024 * 1024 && sourceReal === c.source.path && createHash("sha256").update(sourceBytes).digest("hex") === c.source.contentDigest, "UNTRUSTED_INPUT");
    for (const item of c.repositories.filter((entry: any) => entry.status === "carrying")) {
      const member = members.find((entry) => entry.repositoryId === item.repositoryId && entry.workspaceId === item.workspaceId)!;
      const carryingPath = resolve(member.path, item.carryingPath), carryingStatus = await lstat(carryingPath); requireThat(carryingPath.startsWith(member.path + sep) && carryingStatus.isFile() && !carryingStatus.isSymbolicLink() && await realpath(carryingPath) === carryingPath, "INVALID_CONFIG");
    }
  }
  const anchor = members[0], now = new Date().toISOString(), run: WorkflowRun = { format: "workspacectl-run/1", id: newId("run"), workflowId: request.workflowId, repositoryId: anchor.repositoryId, workspaceId: anchor.workspaceId, coordinationWorkspaceId: value.binding.id, coordinationRevision: value.binding.revision, members, projectContexts: { sharedProjectContext: value.contexts.sharedProjectContext as unknown as Json, repositoryContexts: value.contexts.repositoryContexts as unknown as Json[] }, status: "ready", inputs: structuredClone(request.inputs), inputFingerprint: hash(request.inputs), definitionDigest: value.definitionDigest, actionFingerprints: await commandFingerprints(value.workflow), workspaceFingerprint: anchor.fingerprint, revisions: value.registry.revisions, workspacePath: anchor.path, steps: value.workflow.steps.map((entry) => ({ id: entry.id, type: entry.type, status: "pending", attemptId: null, attempts: 0, history: [], outcome: null })), pending: null, approvals: [], createdAt: now, updatedAt: now };
  await saveRun(value.registry.config, run, true); return execute(run, value.workflow, value.registry.config);
}
async function loadRun(configPath: string, runId: string) {
  requireThat(/^run-[a-f0-9]{24}$/.test(runId), "INVALID_CONFIG"); const registry = await readSelectedRegistry(configPath), path = join(runsDir(registry.config), `${runId}.json`), status = await lstat(path); requireThat(status.isFile() && !status.isSymbolicLink() && status.size <= 2 * 1024 * 1024, "INVALID_CONFIG");
  let run: WorkflowRun; try { run = JSON.parse(await readFile(path, "utf8")); } catch { throw new GovernanceError("INVALID_CONFIG"); } requireThat(run?.format === "workspacectl-run/1" && run.id === runId && Array.isArray(run.steps), "INVALID_CONFIG"); return { registry, run };
}
async function inspectRun(configPath: string, runId: string) {
  const loaded = await loadRun(configPath, runId), run = loaded.run, blockers: string[] = [];
  let workflow: ResolvedWorkflow | undefined, currentRegistry: typeof loaded.registry | undefined;
  try {
    if (run.coordinationWorkspaceId) {
      const current = await selectedCoordination(configPath, run.coordinationWorkspaceId, run.workflowId); workflow = current.workflow; currentRegistry = current.registry;
      if (current.definitionDigest !== run.definitionDigest) blockers.push("workflow-definition");
      if (current.binding.revision !== run.coordinationRevision || canonicalJson(current.members) !== canonicalJson(run.members!.map(({ fingerprint: _fingerprint, ...member }) => member))) blockers.push("coordination-binding");
      for (const member of run.members ?? []) {
        try { const repository = current.registry.catalog.repositories.find((entry) => entry.id === member.repositoryId)!; if (await observeWorkspaceFingerprint(member.path, repository.remote) !== member.fingerprint) blockers.push("workspace-identity"); } catch { blockers.push("workspace-identity"); }
      }
    } else {
      const current = await selected(configPath, run.repositoryId, run.workspaceId, run.workflowId); workflow = current.workflow; currentRegistry = current.registry;
      if (current.definitionDigest !== run.definitionDigest) blockers.push("workflow-definition");
      if (current.workspace.path !== run.workspacePath) blockers.push("workspace-identity");
      try { const repository = current.registry.catalog.repositories.find((entry) => entry.id === run.repositoryId)!; if (await observeWorkspaceFingerprint(run.workspacePath, repository.remote) !== run.workspaceFingerprint) blockers.push("workspace-identity"); } catch { blockers.push("workspace-identity"); }
    }
  } catch { blockers.push("selection"); }
  if (hash(run.inputs) !== run.inputFingerprint) blockers.push("input-fingerprint");
  if (workflow && currentRegistry) {
    if (currentRegistry.revisions.config !== run.revisions.config) blockers.push("config-revision");
    if (currentRegistry.revisions.catalog !== run.revisions.catalog) blockers.push("catalog-policy-trust-revision");
    if (currentRegistry.revisions.localState !== run.revisions.localState) blockers.push("workspace-policy-trust-revision");
    try { if (canonicalJson(await commandFingerprints(workflow)) !== canonicalJson(run.actionFingerprints)) blockers.push("executable-bytes"); } catch { blockers.push("executable-bytes"); }
  }
  return { ...loaded, workflow, blockers: [...new Set(blockers)] };
}
async function currentRun(configPath: string, runId: string) {
  const inspected = await inspectRun(configPath, runId);
  requireThat(inspected.workflow !== undefined && inspected.blockers.length === 0, "STALE_PLAN");
  return { registry: inspected.registry, run: inspected.run, workflow: inspected.workflow };
}
export async function showWorkflowRun(configPath: string, runId: string): Promise<WorkflowRun> {
  const inspected = await inspectRun(configPath, runId);
  return { ...structuredClone(inspected.run), validity: inspected.blockers.length === 0 ? "current" : "stale", blockers: inspected.blockers };
}
function exactPending(run: WorkflowRun, binding: { stepId: string; attemptId: string; requestDigest: string }) { requireThat(run.pending !== null && run.pending.stepId === binding.stepId && run.pending.attemptId === binding.attemptId && run.pending.requestDigest === binding.requestDigest, "STALE_PLAN"); return run.pending; }
async function inspectEvidence(paths: string[]) {
  requireThat(paths.length > 0 && new Set(paths).size === paths.length, "INVALID_CONFIG");
  const evidence = [];
  for (const path of paths) { requireThat(resolve(path) === path, "INVALID_CONFIG"); const status = await lstat(path); requireThat(status.isFile() && !status.isSymbolicLink() && status.size <= 2 * 1024 * 1024 && await realpath(path) === path, "INVALID_CONFIG"); evidence.push({ path, digest: createHash("sha256").update(await readFile(path)).digest("hex") }); }
  return evidence;
}
export async function approveWorkflowRun(configPath: string, runId: string, binding: { stepId: string; attemptId: string; requestDigest: string }): Promise<WorkflowRun> {
  const loaded = await currentRun(configPath, runId), pending = exactPending(loaded.run, binding); requireThat(pending.kind === "command" || pending.kind === "external.action", "INVALID_CONFIG"); requireThat(loaded.run.steps.find((entry) => entry.id === pending.stepId)?.status === "waiting", "INCOMPLETE"); requireThat(!loaded.run.approvals.includes(pending.requestDigest), "CONFLICT"); loaded.run.approvals.push(pending.requestDigest); loaded.run.updatedAt = new Date().toISOString(); await saveRun(loaded.registry.config, loaded.run); return loaded.run;
}
export async function interruptWorkflowRun(configPath: string, runId: string, binding: { stepId: string; attemptId: string; requestDigest: string }): Promise<WorkflowRun> {
  const loaded = await currentRun(configPath, runId), pending = exactPending(loaded.run, binding), state = loaded.run.steps.find((entry) => entry.id === pending.stepId)!;
  requireThat((pending.kind === "command" || pending.kind === "external.action") && state.status === "waiting" && loaded.run.approvals.includes(pending.requestDigest), "INCOMPLETE");
  state.status = "ambiguous"; state.outcome = { ambiguity: "effect-started-outcome-unknown", inspections: [] }; loaded.run.status = "interrupted"; loaded.run.updatedAt = new Date().toISOString(); await saveRun(loaded.registry.config, loaded.run); return loaded.run;
}
export async function submitWorkflowResult(configPath: string, runId: string, submission: { stepId: string; attemptId: string; requestDigest: string; outcome: string; evidenceReferences: string[] }): Promise<WorkflowRun> {
  const loaded = await currentRun(configPath, runId), pending = exactPending(loaded.run, submission), step = loaded.run.steps.find((entry) => entry.id === pending.stepId)!;
  const ambiguous = step.status === "ambiguous";
  requireThat(ambiguous ? ["completed", "not-completed", "unknown"].includes(submission.outcome) : ["agent.task", "external.action"].includes(pending.kind) && submission.outcome === "completed" && step.status === "waiting", "INVALID_CONFIG");
  if (pending.kind === "external.action" || ambiguous) requireThat(loaded.run.approvals.includes(pending.requestDigest), "INVALID_CONFIG");
  const evidence = await inspectEvidence(submission.evidenceReferences);
  if (ambiguous && submission.outcome === "unknown") {
    const outcome = step.outcome as any; outcome.inspections.push({ result: "unknown", evidence }); (step.history ??= []).push({ attemptId: pending.attemptId, resolution: "unknown", evidence }); loaded.run.updatedAt = new Date().toISOString(); await saveRun(loaded.registry.config, loaded.run); return loaded.run;
  }
  if (ambiguous && submission.outcome === "not-completed") {
    const definition = loaded.workflow.steps.find((entry) => entry.id === pending.stepId)!;
    const inspections = [...((step.outcome as any).inspections ?? []), { result: "not-completed", evidence }];
    (step.history ??= []).push({ attemptId: pending.attemptId, resolution: "not-completed", evidence });
    beginAttempt(loaded.run, definition); step.outcome = { ambiguityResolved: "not-completed", inspections }; loaded.run.updatedAt = new Date().toISOString(); await saveRun(loaded.registry.config, loaded.run); return loaded.run;
  }
  step.status = "claimed"; step.outcome = ambiguous ? { ambiguityResolved: "completed", claim: submission.outcome, evidence } : { claim: submission.outcome, evidence }; loaded.run.updatedAt = new Date().toISOString(); await saveRun(loaded.registry.config, loaded.run); return loaded.run;
}
async function revalidateReusable(run: WorkflowRun, workflow: ResolvedWorkflow): Promise<void> {
  for (const state of run.steps.filter((entry) => entry.status === "completed" && ["agent.task", "verify"].includes(entry.type))) {
    const definition = workflow.steps.find((entry) => entry.id === state.id)!;
    const checks = definition.type === "verify" ? (definition.configuration as any).checks : (definition.configuration as any).verification;
    const verified = await verifyChecks(targetFor(run, definition.configuration as any).path, validateVerification(checks));
    const outcome = state.outcome as any, previous = outcome.verified ?? [];
    outcome.revalidations ??= [];
    outcome.revalidations.push({ changed: canonicalJson(previous) !== canonicalJson(verified), previous, verified });
    outcome.verified = verified;
  }
}
function commandReadbackChecks(workflow: ResolvedWorkflow, commandId: string): Json[] {
  const checks = workflow.steps
    .filter((entry) => entry.type === "verify" && entry.needs.includes(commandId))
    .flatMap((entry) => validateVerification((entry.configuration as any).checks));
  requireThat(checks.length > 0, "INCOMPLETE");
  return checks;
}
const boundedOutput = (value: string | Buffer | null | undefined) => String(value ?? "").slice(0, 16_384);
async function resumeWorkflowLocked(configPath: string, runId: string, env: NodeJS.ProcessEnv): Promise<WorkflowRun> {
  const loaded = await currentRun(configPath, runId), run = loaded.run;
  if (run.status === "completed") return run;
  if (run.status === "failed") {
    const state = run.steps.find((entry) => entry.status === "failed")!, definition = loaded.workflow.steps.find((entry) => entry.id === state.id)!;
    requireThat(definition.retry.mode === "safe" && (state.attempts ?? 1) < definition.retry.maxAttempts, "INCOMPLETE");
    await revalidateReusable(run, loaded.workflow); beginAttempt(run, definition); run.updatedAt = new Date().toISOString(); await saveRun(loaded.registry.config, run); return run;
  }
  requireThat(run.pending !== null, "INCOMPLETE"); const pending = run.pending, definition = loaded.workflow.steps.find((entry) => entry.id === pending.stepId)!, state = run.steps.find((entry) => entry.id === pending.stepId)!;
  if (pending.kind === "agent.task" || pending.kind === "external.action") {
    requireThat(state.status === "claimed", "INCOMPLETE");
    const verified = await verifyChecks(targetFor(run, definition.configuration as any).path, validateVerification((definition.configuration as any).verification)); state.status = "completed"; state.outcome = { ...(state.outcome as any), verified };
  } else if (state.status === "claimed" && (state.outcome as any)?.ambiguityResolved === "completed") {
    const verified = await verifyChecks(targetFor(run, definition.configuration as any).path, commandReadbackChecks(loaded.workflow, pending.stepId));
    state.status = "completed"; state.outcome = { ...(state.outcome as any), verified };
  } else {
    requireThat(state.status === "waiting" && run.approvals.includes(pending.requestDigest), "INCOMPLETE");
    const c = definition.configuration as any, childEnv: NodeJS.ProcessEnv = Object.create(null); for (const name of c.environment) { requireThat(typeof env[name] === "string", "INVALID_CONFIG"); childEnv[name] = env[name]; }
    const workspacePath = targetFor(run, c).path;
    const result = spawnSync(c.executable, c.argv, { cwd: workspacePath, env: childEnv, encoding: "utf8", timeout: c.timeoutMs, maxBuffer: 2 * 1024 * 1024, shell: false });
    const outcome = { executable: c.executable, argv: c.argv, cwd: workspacePath, environment: c.environment, expectedExit: c.expectedExit, exit: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: boundedOutput(result.stdout), stderr: boundedOutput(result.stderr), stdoutDigest: createHash("sha256").update(result.stdout ?? "").digest("hex"), stderrDigest: createHash("sha256").update(result.stderr ?? "").digest("hex") };
    state.outcome = outcome as any;
    if (result.error || result.signal !== null || result.status !== c.expectedExit) { (state.history ??= []).push({ attemptId: pending.attemptId, outcome }); state.status = "failed"; run.pending = null; run.status = "failed"; run.updatedAt = new Date().toISOString(); await saveRun(loaded.registry.config, run); return run; }
    state.status = "completed";
  }
  run.pending = null; run.status = "running"; run.updatedAt = new Date().toISOString(); await saveRun(loaded.registry.config, run); return execute(run, loaded.workflow, loaded.registry.config);
}
export async function resumeWorkflow(configPath: string, runId: string, env: NodeJS.ProcessEnv = process.env): Promise<WorkflowRun> {
  return withRunLock(configPath, runId, () => resumeWorkflowLocked(configPath, runId, env));
}
