import { resolve } from "node:path";
import { canonicalJson, canonicalRemote, digest, GovernanceError, requireThat } from "./core.ts";
import { readSelectedRegistry } from "./catalog-readback.ts";
import { FileLocalStateStore, writeLocalStateDocument } from "./document-stores.ts";
import { discoverLocal } from "./discovery.ts";
import { loadRelevantContext } from "./relevant-context.ts";
import { resolveCatalogContext } from "./v2-context.ts";
import type { RelevantContext } from "./relevant-context.ts";
import { documentRevision, validateLocalStateDocument } from "./v2-model.ts";
import type { GroupRecord, HostActionReceipt, RepositoryRecord, RepositoryWorkspace } from "./v2-model.ts";

export interface LogicalOpenTarget {
  kind: "repository" | "group";
  id: string;
  label: string;
}

export interface ContextReference {
  repositoryId: string | null;
  workspaceId: string | null;
  selectedProjectId: string | null;
  revisions: { catalog: string; localState: string };
}

export interface HermesProjectRequest {
  id: string;
  operation: "list" | "create" | "switch";
  projectId?: string | null;
  name?: string;
  path?: string;
  createdProjectFromRequestId?: string;
}

interface HostActionBase {
  schemaVersion: 1;
  id: string;
  digest: string;
  logicalTarget: LogicalOpenTarget;
  cwd: string;
  projectName: string;
  contextReference: ContextReference;
}

export interface HermesHostAction extends HostActionBase {
  host: "hermes";
  type: "hermes-project";
  requests: HermesProjectRequest[];
}

export interface TerminalHostAction extends HostActionBase {
  host: "terminal";
  type: "terminal-launch";
  requests: [];
}

export type OpenHostAction = HermesHostAction | TerminalHostAction;

export interface RepositoryOpenResult {
  schemaVersion: 1;
  kind: "repository";
  logicalTarget: LogicalOpenTarget;
  repository: RepositoryRecord;
  workspace: RepositoryWorkspace;
  path: string;
  context: RelevantContext;
  revisions: { catalog: string; localState: string };
  hostAction: OpenHostAction | null;
}

export interface GroupOpenMember {
  repositoryId: string;
  workspaceId: string;
  path: string;
  context: RelevantContext;
}

export interface GroupOpenResult {
  schemaVersion: 1;
  kind: "group";
  logicalTarget: LogicalOpenTarget;
  group: GroupRecord;
  members: GroupOpenMember[];
  coordinationWorkspace: null | { id: string; path: string; hostProjectId: string | null };
  path: string | null;
  context: { projectId: string | null; repositoryContexts: RelevantContext[] };
  revisions: { catalog: string; localState: string };
  hostAction: OpenHostAction | null;
}

export type OpenResult = RepositoryOpenResult | GroupOpenResult;

export interface OpenTargetRequest {
  target: string;
  host?: "hermes" | "terminal" | "codex";
  activate?: boolean;
}

export interface HostReadback {
  actionId: string;
  actionDigest: string;
  activation: "native-project";
  results: Array<
    | { requestId: string; operation: "list"; projects: Array<{ id: string; name: string; path: string }> }
    | { requestId: string; operation: "create" | "switch"; project: { id: string; name: string; path: string } }
  >;
  project: { id: string; name: string; path: string };
  effectiveToolCwd: string;
}

export interface VerifiedHostResult {
  schemaVersion: 1;
  actionId: string;
  actionDigest: string;
  host: "hermes";
  logicalTarget: LogicalOpenTarget;
  project: { id: string; name: string; path: string };
  effectiveToolCwd: string;
  contextReference: ContextReference;
  readbackStatus: "exact";
}

const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function exactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []): asserts value is Record<string, any> {
  requireThat(plain(value) && required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key)), "INVALID_CONFIG");
}
const id = (value: unknown) => requireThat(typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\x00-\x1f/\\]/.test(value), "INVALID_CONFIG");
const absolute = (value: unknown) => requireThat(typeof value === "string" && value === resolve(value) && !/[\x00\r\n]/.test(value), "INVALID_CONFIG");
const revision = (value: unknown) => requireThat(typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value), "INVALID_CONFIG");

function contextReference(result: OpenResult): ContextReference {
  if (result.kind === "repository") return {
    repositoryId: result.repository.id,
    workspaceId: result.workspace.id,
    selectedProjectId: result.context.project?.id ?? null,
    revisions: result.revisions,
  };
  return {
    repositoryId: null,
    workspaceId: null,
    selectedProjectId: result.group.kind === "project" ? result.group.id : null,
    revisions: result.revisions,
  };
}

function actionSemantic(value: Omit<OpenHostAction, "id" | "digest">): Record<string, unknown> {
  return structuredClone(value) as unknown as Record<string, unknown>;
}

export function validateHostAction(input: unknown): OpenHostAction {
  exactKeys(input, ["schemaVersion", "id", "digest", "logicalTarget", "cwd", "projectName", "contextReference", "host", "type", "requests"]);
  requireThat(input.schemaVersion === 1, "INVALID_CONFIG");
  id(input.id); absolute(input.cwd);
  requireThat(typeof input.projectName === "string" && input.projectName.length > 0 && input.projectName.length <= 256, "INVALID_CONFIG");
  requireThat(typeof input.digest === "string" && /^[a-f0-9]{64}$/.test(input.digest), "INVALID_CONFIG");
  exactKeys(input.logicalTarget, ["kind", "id", "label"]);
  requireThat(["repository", "group"].includes(input.logicalTarget.kind), "INVALID_CONFIG"); id(input.logicalTarget.id);
  requireThat(typeof input.logicalTarget.label === "string" && input.logicalTarget.label.length > 0, "INVALID_CONFIG");
  exactKeys(input.contextReference, ["repositoryId", "workspaceId", "selectedProjectId", "revisions"]);
  for (const key of ["repositoryId", "workspaceId", "selectedProjectId"] as const) if (input.contextReference[key] !== null) id(input.contextReference[key]);
  exactKeys(input.contextReference.revisions, ["catalog", "localState"]); revision(input.contextReference.revisions.catalog); revision(input.contextReference.revisions.localState);
  requireThat(Array.isArray(input.requests), "INVALID_CONFIG");
  if (input.host === "terminal") requireThat(input.type === "terminal-launch" && input.requests.length === 0, "INVALID_CONFIG");
  else {
    requireThat(input.host === "hermes" && input.type === "hermes-project" && [2, 3].includes(input.requests.length), "INVALID_CONFIG");
    for (const request of input.requests) {
      exactKeys(request, ["id", "operation"], ["projectId", "name", "path", "createdProjectFromRequestId"]); id(request.id);
      requireThat(["list", "create", "switch"].includes(request.operation), "INVALID_CONFIG");
      if (request.path !== undefined) absolute(request.path);
    }
    const [list, middle] = input.requests;
    exactKeys(list, ["id", "operation"]); requireThat(list.operation === "list", "INVALID_CONFIG");
    const create = input.requests.length === 3 ? middle : undefined;
    const switchRequest = input.requests.at(-1)!;
    if (create !== undefined) {
      exactKeys(create, ["id", "operation", "name", "path"]);
      requireThat(create.operation === "create" && typeof create.name === "string" && create.name.length > 0, "INVALID_CONFIG"); absolute(create.path);
      exactKeys(switchRequest, ["id", "operation", "projectId", "createdProjectFromRequestId"]);
      requireThat(switchRequest.operation === "switch" && switchRequest.projectId === null && switchRequest.createdProjectFromRequestId === create.id, "INVALID_CONFIG");
    } else {
      exactKeys(switchRequest, ["id", "operation", "projectId", "path"]);
      requireThat(switchRequest.operation === "switch" && typeof switchRequest.projectId === "string", "INVALID_CONFIG"); id(switchRequest.projectId); absolute(switchRequest.path);
    }
  }
  const semantic = { ...input }; delete semantic.id; delete semantic.digest;
  const expected = digest(semantic);
  requireThat(input.digest === expected && input.id === `host-action-${expected.slice(0, 24)}`, "INVALID_CONFIG");
  return structuredClone(input) as OpenHostAction;
}

export function createOpenHostAction(result: OpenResult, host: "hermes" | "terminal"): OpenHostAction {
  requireThat(result.path !== null, "NOT_FOUND");
  const projectName = result.logicalTarget.label;
  const base = {
    schemaVersion: 1 as const,
    logicalTarget: result.logicalTarget,
    cwd: result.path,
    projectName,
    contextReference: contextReference(result),
  };
  let semantic: Omit<OpenHostAction, "id" | "digest">;
  if (host === "terminal") semantic = { ...base, host, type: "terminal-launch", requests: [] };
  else {
    const projectId = result.kind === "repository" && typeof result.workspace.hostLinks.hermesProjectId === "string"
      ? result.workspace.hostLinks.hermesProjectId
      : result.kind === "group" && result.coordinationWorkspace !== null
        ? result.coordinationWorkspace.hostProjectId ?? undefined
        : undefined;
    const requests: HermesProjectRequest[] = [{ id: "list-projects", operation: "list" }];
    if (projectId === undefined) {
      requests.push({ id: "create-project", operation: "create", name: projectName, path: result.path });
      requests.push({ id: "switch-project", operation: "switch", projectId: null, createdProjectFromRequestId: "create-project" });
    } else requests.push({ id: "switch-project", operation: "switch", projectId, path: result.path });
    semantic = { ...base, host, type: "hermes-project", requests };
  }
  const value = actionSemantic(semantic);
  const actionDigest = digest(value);
  return validateHostAction({ ...semantic, id: `host-action-${actionDigest.slice(0, 24)}`, digest: actionDigest });
}

async function verifiedWorkspace(repository: RepositoryRecord, workspace: RepositoryWorkspace, trustedRoots: string[]): Promise<void> {
  const inventory = await discoverLocal(workspace.path, { depth: 0, trustedMetadataRoots: trustedRoots });
  const observed = inventory.repositories.find((entry) => entry.path === workspace.path);
  requireThat(observed !== undefined && observed.remote !== null, "UNAVAILABLE");
  requireThat(observed.remote === canonicalRemote(repository.remote), "CONFLICT");
}

function groupDescendants(groups: GroupRecord[], groupId: string): Set<string> {
  const ids = new Set([groupId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) if (group.parentId !== null && ids.has(group.parentId) && !ids.has(group.id)) { ids.add(group.id); changed = true; }
  }
  return ids;
}

function selectedWorkspace(repositoryId: string, workspaces: RepositoryWorkspace[]): RepositoryWorkspace {
  const selected = workspaces.filter((workspace) => workspace.repositoryId === repositoryId && workspace.primarySelected);
  if (selected.length === 0) throw new GovernanceError("NOT_FOUND", { repositoryId, reason: "no-selected-primary" });
  if (selected.length > 1) throw new GovernanceError("AMBIGUOUS", { repositoryId, reason: "multiple-selected-primary" });
  return selected[0];
}

export async function openTarget(configPath: string, request: OpenTargetRequest): Promise<OpenResult> {
  exactKeys(request, ["target"], ["host", "activate"]);
  requireThat(typeof request.target === "string" && request.target.length > 0 && request.target.length <= 16_384, "INVALID_CONFIG");
  requireThat(request.activate === undefined || typeof request.activate === "boolean", "INVALID_CONFIG");
  if (request.host !== undefined && !["hermes", "terminal", "codex"].includes(request.host)) throw new GovernanceError("UNSUPPORTED");
  if (request.activate === true) requireThat(request.host !== undefined, "INVALID_CONFIG");
  if (request.host === "codex" && request.activate === true) throw new GovernanceError("UNSUPPORTED");
  const registry = await readSelectedRegistry(configPath);
  const repositoryMatches = registry.catalog.repositories.filter((repository) => repository.id === request.target || repository.aliases.some((alias) => alias.toLowerCase() === request.target.toLowerCase()) || canonicalRemote(repository.remote) === (() => { try { return canonicalRemote(request.target); } catch { return ""; } })());
  const groupMatches = registry.catalog.groups.filter((group) => group.id === request.target || group.slug.toLowerCase() === request.target.toLowerCase());
  requireThat(repositoryMatches.length + groupMatches.length > 0, "NOT_FOUND");
  requireThat(repositoryMatches.length + groupMatches.length === 1, "AMBIGUOUS");
  const revisions = { catalog: registry.revisions.catalog, localState: registry.revisions.localState };
  let result: OpenResult;
  if (repositoryMatches.length === 1) {
    const repository = repositoryMatches[0];
    const workspace = selectedWorkspace(repository.id, registry.localState.repositoryWorkspaces);
    await verifiedWorkspace(repository, workspace, registry.config.trustedRoots);
    const base = resolveCatalogContext(registry.catalog, registry.localState, { repositoryId: repository.id, workspaceId: workspace.id });
    base.revisions = revisions;
    const context = await loadRelevantContext(base, { catalogPath: registry.config.catalog.path, trustedRoots: registry.config.trustedRoots, groups: registry.catalog.groups });
    result = { schemaVersion: 1, kind: "repository", logicalTarget: { kind: "repository", id: repository.id, label: repository.id }, repository, workspace, path: workspace.path, context, revisions, hostAction: null };
  } else {
    const group = groupMatches[0];
    const descendants = groupDescendants(registry.catalog.groups, group.id);
    const repositories = registry.catalog.repositories.filter((repository) => (repository.primaryGroupId !== null && descendants.has(repository.primaryGroupId)) || (group.kind === "project" && repository.memberOf.includes(group.id))).sort((a, b) => a.id.localeCompare(b.id));
    const members: GroupOpenMember[] = [];
    for (const repository of repositories) {
      const workspace = selectedWorkspace(repository.id, registry.localState.repositoryWorkspaces);
      await verifiedWorkspace(repository, workspace, registry.config.trustedRoots);
      const base = resolveCatalogContext(registry.catalog, registry.localState, { repositoryId: repository.id, workspaceId: workspace.id, ...(group.kind === "project" ? { selectedProjectId: group.id } : {}) });
      base.revisions = revisions;
      members.push({ repositoryId: repository.id, workspaceId: workspace.id, path: workspace.path, context: await loadRelevantContext(base, { catalogPath: registry.config.catalog.path, trustedRoots: registry.config.trustedRoots, groups: registry.catalog.groups }) });
    }
    const coordination = registry.localState.coordinationWorkspaces.find((workspace) => workspace.scope.id === group.id) ?? null;
    result = { schemaVersion: 1, kind: "group", logicalTarget: { kind: "group", id: group.id, label: group.name }, group, members, coordinationWorkspace: coordination === null ? null : { id: coordination.id, path: coordination.path, hostProjectId: coordination.hostProjectId }, path: coordination?.path ?? null, context: { projectId: group.kind === "project" ? group.id : null, repositoryContexts: members.map((member) => member.context) }, revisions, hostAction: null };
  }
  if (request.activate === true) {
    result.hostAction = createOpenHostAction(result, request.host as "hermes" | "terminal");
    if (result.hostAction.host === "hermes") {
      const receipt: HostActionReceipt = { actionId: result.hostAction.id, actionDigest: result.hostAction.digest, configRevision: registry.revisions.config, catalogRevision: revisions.catalog, contextLocalStateRevision: revisions.localState, status: "pending" };
      const next = structuredClone(registry.localState);
      next.hostActionReceipts ??= [];
      requireThat(!next.hostActionReceipts.some((candidate) => candidate.actionId === receipt.actionId), "CONFLICT");
      next.hostActionReceipts.push(receipt);
      await writeLocalStateDocument(new FileLocalStateStore(registry.config.localState.path), revisions.localState, validateLocalStateDocument(next));
    }
  }
  return result;
}

export function validateVerifiedHostResult(input: unknown): VerifiedHostResult {
  exactKeys(input, ["schemaVersion", "actionId", "actionDigest", "host", "logicalTarget", "project", "effectiveToolCwd", "contextReference", "readbackStatus"]);
  requireThat(input.schemaVersion === 1 && input.host === "hermes" && input.readbackStatus === "exact", "INVALID_CONFIG");
  id(input.actionId); requireThat(typeof input.actionDigest === "string" && /^[a-f0-9]{64}$/.test(input.actionDigest), "INVALID_CONFIG");
  exactKeys(input.project, ["id", "name", "path"]); id(input.project.id); absolute(input.project.path); absolute(input.effectiveToolCwd);
  requireThat(typeof input.project.name === "string" && input.project.name.length > 0, "INVALID_CONFIG");
  exactKeys(input.logicalTarget, ["kind", "id", "label"]);
  requireThat(["repository", "group"].includes(input.logicalTarget.kind), "INVALID_CONFIG"); id(input.logicalTarget.id);
  requireThat(typeof input.logicalTarget.label === "string" && input.logicalTarget.label.length > 0, "INVALID_CONFIG");
  exactKeys(input.contextReference, ["repositoryId", "workspaceId", "selectedProjectId", "revisions"]);
  for (const key of ["repositoryId", "workspaceId", "selectedProjectId"] as const) if (input.contextReference[key] !== null) id(input.contextReference[key]);
  exactKeys(input.contextReference.revisions, ["catalog", "localState"]);
  revision(input.contextReference.revisions.catalog); revision(input.contextReference.revisions.localState);
  return structuredClone(input) as VerifiedHostResult;
}

export async function acknowledgeHostAction(configPath: string, actionInput: unknown, readbackInput: unknown): Promise<VerifiedHostResult> {
  const action = validateHostAction(actionInput);
  requireThat(action.host === "hermes", "UNSUPPORTED");
  try {
    const registry = await readSelectedRegistry(configPath);
    const receipt = registry.localState.hostActionReceipts?.find((candidate) => candidate.actionId === action.id);
    requireThat(receipt?.status === "pending" && receipt.actionDigest === action.digest && receipt.configRevision === registry.revisions.config && receipt.catalogRevision === registry.revisions.catalog && receipt.catalogRevision === action.contextReference.revisions.catalog && receipt.contextLocalStateRevision === action.contextReference.revisions.localState, "ACTION_FAILED");
    const withoutReceipt = structuredClone(registry.localState);
    withoutReceipt.hostActionReceipts = withoutReceipt.hostActionReceipts?.filter((candidate) => candidate.actionId !== action.id);
    if (withoutReceipt.hostActionReceipts?.length === 0) delete withoutReceipt.hostActionReceipts;
    requireThat(documentRevision(withoutReceipt) === receipt.contextLocalStateRevision, "ACTION_FAILED");
    exactKeys(readbackInput, ["actionId", "actionDigest", "activation", "results", "project", "effectiveToolCwd"]);
    requireThat(readbackInput.actionId === action.id && readbackInput.actionDigest === action.digest && readbackInput.activation === "native-project", "ACTION_FAILED");
    requireThat(Array.isArray(readbackInput.results) && readbackInput.results.length === action.requests.length, "ACTION_FAILED");
    exactKeys(readbackInput.project, ["id", "name", "path"]);
    id(readbackInput.project.id); requireThat(readbackInput.project.name === action.projectName && readbackInput.project.path === action.cwd && readbackInput.effectiveToolCwd === action.cwd, "ACTION_FAILED");
    let createdProjectId: string | undefined;
    for (let index = 0; index < action.requests.length; index += 1) {
      const request = action.requests[index], result = readbackInput.results[index];
      requireThat(plain(result) && result.requestId === request.id && result.operation === request.operation, "ACTION_FAILED");
      if (request.operation === "list") {
        exactKeys(result, ["requestId", "operation", "projects"]); requireThat(Array.isArray(result.projects), "ACTION_FAILED");
      } else {
        exactKeys(result, ["requestId", "operation", "project"]); exactKeys(result.project, ["id", "name", "path"]); id(result.project.id);
        requireThat(result.project.name === action.projectName && result.project.path === action.cwd, "ACTION_FAILED");
        if (request.operation === "create") createdProjectId = result.project.id;
        else requireThat(result.project.id === (request.projectId ?? createdProjectId), "ACTION_FAILED");
      }
    }
    const finalResult = readbackInput.results.at(-1);
    requireThat(finalResult?.operation === "switch" && finalResult.project.id === readbackInput.project.id, "ACTION_FAILED");
    const result: VerifiedHostResult = { schemaVersion: 1, actionId: action.id, actionDigest: action.digest, host: "hermes", logicalTarget: action.logicalTarget, project: structuredClone(readbackInput.project) as any, effectiveToolCwd: readbackInput.effectiveToolCwd as string, contextReference: action.contextReference, readbackStatus: "exact" };
    const verified = validateVerifiedHostResult(result);
    const next = structuredClone(registry.localState);
    const pending = next.hostActionReceipts?.find((candidate) => candidate.actionId === action.id);
    requireThat(pending?.status === "pending", "ACTION_FAILED");
    pending.status = "consumed"; pending.resultDigest = digest(verified);
    if (action.contextReference.workspaceId !== null) {
      const workspace = next.repositoryWorkspaces.find((candidate) => candidate.id === action.contextReference.workspaceId && candidate.repositoryId === action.contextReference.repositoryId);
      requireThat(workspace !== undefined && workspace.path === action.cwd, "ACTION_FAILED");
      workspace.hostLinks.hermesProjectId = verified.project.id;
    } else {
      const coordination = next.coordinationWorkspaces.find((candidate) => candidate.scope.id === action.logicalTarget.id && candidate.path === action.cwd);
      requireThat(coordination !== undefined, "ACTION_FAILED");
      coordination.hostProjectId = verified.project.id;
      const bindingBase = { ...coordination } as Record<string, unknown>; delete bindingBase.revision;
      coordination.revision = documentRevision(bindingBase);
    }
    await writeLocalStateDocument(new FileLocalStateStore(registry.config.localState.path), registry.revisions.localState, validateLocalStateDocument(next));
    return verified;
  } catch (error) {
    if (error instanceof GovernanceError && error.code === "ACTION_FAILED") throw error;
    throw new GovernanceError("ACTION_FAILED");
  }
}
