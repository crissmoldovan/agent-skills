import { isAbsolute } from "node:path";
import { parseDocument, visit } from "yaml";
import {
  canonicalJson,
  canonicalRemote,
  digest,
  GovernanceError,
  requireThat,
} from "./core.ts";
import type { Json } from "./core.ts";
import { validatePolicyRecord, validateWorkflowRecord } from "./v2-rules.ts";
import type { PolicyRecord, WorkflowRecord } from "./v2-rules.ts";

export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const MAX_CONFIG_BYTES = 256 * 1024;
export const ABSENT_REVISION = "absent";

const unsafe = new Set(["__proto__", "prototype", "constructor"]);
const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

function objectKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
  code = "INVALID_CONFIG",
): asserts value is Record<string, any> {
  requireThat(plain(value), code);
  requireThat(
    required.every((key) => Object.hasOwn(value, key)) &&
      Object.keys(value).every(
        (key) => required.includes(key) || optional.includes(key),
      ),
    code,
  );
}

function asJson(value: unknown, code = "INVALID_CONFIG"): asserts value is Json {
  try {
    canonicalJson(value);
  } catch {
    throw new GovernanceError(code);
  }
}

function identifier(value: unknown, code = "INVALID_CONFIG"): asserts value is string {
  requireThat(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= 256 &&
      !/[\x00-\x1f/\\]/.test(value) &&
      !unsafe.has(value),
    code,
  );
}

function displayName(value: unknown, code = "INVALID_CONFIG"): asserts value is string {
  requireThat(
    typeof value === "string" &&
      value.length > 0 &&
      [...value].length <= 256 &&
      value.trim() === value &&
      !/[\x00-\x1f\x7f]/.test(value),
    code,
  );
}

function slug(value: unknown, code = "INVALID_CONFIG"): asserts value is string {
  requireThat(
    typeof value === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value) &&
      !value.endsWith(".") &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value),
    code,
  );
}

function absolutePath(value: unknown, code = "INVALID_CONFIG"): asserts value is string {
  requireThat(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= 16_384 &&
      !/[\x00\r\n]/.test(value) &&
      isAbsolute(value),
    code,
  );
}

function revision(value: unknown, allowAbsent = true): asserts value is string {
  requireThat(
    typeof value === "string" &&
      ((allowAbsent && value === ABSENT_REVISION) ||
        /^sha256:[a-f0-9]{64}$/.test(value)),
    "INVALID_CONFIG",
  );
}

function unique(values: string[], code = "INVALID_CONFIG"): void {
  requireThat(new Set(values).size === values.length, code);
}

function cloneValidated<T>(value: T): T {
  return structuredClone(value);
}

export type DataFormat = "json" | "yaml";

export function parseDataText(
  text: string,
  format: DataFormat,
  maxBytes = MAX_DOCUMENT_BYTES,
): unknown {
  requireThat(
    typeof text === "string" &&
      Number.isSafeInteger(maxBytes) &&
      maxBytes > 0 &&
      maxBytes <= MAX_DOCUMENT_BYTES &&
      Buffer.byteLength(text, "utf8") <= maxBytes,
    "INVALID_CONFIG",
  );
  if (format === "json") {
    const { parseJson } = requireJsonParser();
    try {
      return parseJson(text);
    } catch {
      throw new GovernanceError("INVALID_CONFIG");
    }
  }
  requireThat(format === "yaml", "INVALID_CONFIG");
  try {
    const document = parseDocument(text, {
      version: "1.2",
      schema: "core",
      strict: true,
      uniqueKeys: true,
      merge: false,
      resolveKnownTags: false,
      stringKeys: true,
      prettyErrors: false,
      logLevel: "silent",
    });
    requireThat(
      document.errors.length === 0 && document.warnings.length === 0,
      "INVALID_CONFIG",
    );
    let unsupportedReference = false;
    visit(document, {
      Alias: () => {
        unsupportedReference = true;
        return visit.BREAK;
      },
      Node: (_key, node) => {
        if ("anchor" in node && typeof node.anchor === "string") {
          unsupportedReference = true;
          return visit.BREAK;
        }
      },
    });
    requireThat(!unsupportedReference, "INVALID_CONFIG");
    const value = document.toJS({ maxAliasCount: 0, mapAsMap: false });
    asJson(value);
    return value;
  } catch (error) {
    if (error instanceof GovernanceError) throw error;
    throw new GovernanceError("INVALID_CONFIG");
  }
}

// Kept behind a function so both parsers preserve one duplicate-safe JSON implementation.
function requireJsonParser() {
  return { parseJson: parseJsonDirect };
}
import { parseJson as parseJsonDirect } from "./core.ts";

export interface StoreSelector {
  adapter: string;
  path: string;
}

export interface WorkspacesConfig {
  schemaVersion: 2;
  documentType: "workspacectl/config";
  catalog: StoreSelector;
  localState: StoreSelector;
  plans: { directory: string };
  trustedRoots: string[];
}

export interface GroupRecord {
  id: string;
  kind: "organization" | "area" | "project";
  name: string;
  slug: string;
  parentId: string | null;
  metadata: Record<string, Json>;
}

export interface RepositoryRecord {
  id: string;
  remote: string;
  sourceId: string | null;
  primaryGroupId: string | null;
  memberOf: string[];
  aliases: string[];
  classification: "confirmed" | "suggested" | "unclassified";
  metadata: Record<string, Json>;
}

export interface SourceRecord {
  id: string;
  provider: "github";
  owner: string;
  ownerType: "organization" | "user";
  include: string[];
  exclude: string[];
  proposedDefaultGroupId: string | null;
  metadata: Record<string, Json>;
}

export interface CatalogDocument {
  schemaVersion: 2;
  documentType: "workspacectl/catalog";
  groups: GroupRecord[];
  repositories: RepositoryRecord[];
  sources: SourceRecord[];
  policies: PolicyRecord[];
  workflows: WorkflowRecord[];
  metadata: Record<string, Json>;
}

export interface LocalStateDocument {
  schemaVersion: 2;
  documentType: "workspacectl/local-state";
  selectedConfig: { path: string; revision: string };
  repositoryWorkspaces: RepositoryWorkspace[];
  coordinationWorkspaces: CoordinationWorkspace[];
  hostActionReceipts?: HostActionReceipt[];
  workspacePolicyOverlays: PolicyRecord[];
  workspaceWorkflowOverlays?: WorkflowRecord[];
  trustedInputApprovals: [];
  planReferences: [];
  runReferences: [];
  metadata: Record<string, Json>;
}

export interface RepositoryWorkspace {
  id: string;
  kind: "primary" | "worktree";
  repositoryId: string;
  path: string;
  branch: string | null;
  primarySelected: boolean;
  hostLinks: { hermesProjectId?: string };
}

export interface CoordinationWorkspace {
  id: string;
  kind: "coordination";
  scope: { kind: "organization" | "area" | "project"; id: string };
  path: string;
  memberRepositoryIds: string[];
  memberWorkspaceIds: string[];
  hostProjectId: string | null;
  generatedFiles: string[];
  revision: string;
}

export interface HostActionReceipt {
  actionId: string;
  actionDigest: string;
  configRevision: string;
  catalogRevision: string;
  contextLocalStateRevision: string;
  status: "pending" | "consumed";
  resultDigest?: string;
}

export interface PlanAction {
  id: string;
  type: "document-cas" | "directory-create" | "file-create" | "git-clone" | "directory-publish" | "directory-rename" | "git-worktree-add" | "git-worktree-remove";
  target?: "config" | "catalog" | "local-state";
  path: string;
  expectedRevision?: string;
  nextRevision?: string;
  sha256?: string;
}

export interface DocumentPlanAction extends PlanAction {
  type: "document-cas";
  target: "config" | "catalog" | "local-state";
  expectedRevision: string;
  nextRevision: string;
}

export interface DirectoryCreateAction extends PlanAction {
  type: "directory-create";
}

export interface FileCreateAction extends PlanAction {
  type: "file-create";
  sha256: string;
}

export interface PlanPrecondition {
  id: string;
  type: "revision" | "source-digest";
  target: string;
  expected: string;
}

export interface PlanExpectedOutput {
  id: string;
  type: "document";
  target: "config" | "catalog" | "local-state";
  revision: string;
}

export interface WorkspacePlan {
  schemaVersion: 2;
  format: "workspacectl-plan/1";
  id: string;
  kind: "init" | "import-v1" | "catalog-edit" | "workspace-edit" | "workspace-primary" | "adopt" | "coordination-create" | "checkout" | "checkout-reconcile" | "checkout-move" | "checkout-move-reconcile" | "worktree-create" | "worktree-remove";
  createdAt: string;
  inputRevisions: {
    config: string;
    catalog: string;
    localState: string;
    sources: Record<string, string>;
  };
  repositoryIds: string[];
  request: Record<string, Json>;
  actions: PlanAction[];
  preconditions: PlanPrecondition[];
  expectedOutputs: PlanExpectedOutput[];
  approvalsRequired: Array<{ id: "apply"; kind: "explicit-plan-id" }>;
  semanticDigest: string;
}

export function validateConfigDocument(input: unknown): WorkspacesConfig {
  asJson(input);
  const value = cloneValidated(input) as Record<string, any>;
  objectKeys(value, [
    "schemaVersion",
    "documentType",
    "catalog",
    "localState",
    "plans",
    "trustedRoots",
  ]);
  requireThat(
    value.schemaVersion === 2 && value.documentType === "workspacectl/config",
    "INVALID_CONFIG",
  );
  for (const selector of [value.catalog, value.localState]) {
    objectKeys(selector, ["adapter", "path"]);
    requireThat(
      typeof selector.adapter === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(selector.adapter),
      "INVALID_CONFIG",
    );
    absolutePath(selector.path);
  }
  objectKeys(value.plans, ["directory"]);
  absolutePath(value.plans.directory);
  requireThat(Array.isArray(value.trustedRoots) && value.trustedRoots.length <= 64);
  value.trustedRoots.forEach((path: unknown) => absolutePath(path));
  unique(value.trustedRoots);
  unique([
    value.catalog.path,
    value.localState.path,
  ]);
  return value as WorkspacesConfig;
}

export function validateCatalogDocument(input: unknown): CatalogDocument {
  asJson(input);
  const value = cloneValidated(input) as Record<string, any>;
  objectKeys(value, [
    "schemaVersion",
    "documentType",
    "groups",
    "repositories",
    "sources",
    "policies",
    "workflows",
    "metadata",
  ]);
  requireThat(
    value.schemaVersion === 2 && value.documentType === "workspacectl/catalog",
    "INVALID_CONFIG",
  );
  requireThat(Array.isArray(value.groups) && value.groups.length <= 10_000);
  requireThat(Array.isArray(value.repositories) && value.repositories.length <= 10_000);
  requireThat(Array.isArray(value.sources) && value.sources.length <= 1_000);
  requireThat(Array.isArray(value.policies) && value.policies.length <= 20_000);
  requireThat(Array.isArray(value.workflows) && value.workflows.length <= 20_000);
  requireThat(plain(value.metadata));

  const groups = new Map<string, GroupRecord>();
  for (const group of value.groups) {
    objectKeys(group, ["id", "kind", "name", "slug", "parentId", "metadata"]);
    identifier(group.id);
    requireThat(["organization", "area", "project"].includes(group.kind));
    displayName(group.name);
    slug(group.slug);
    requireThat(group.parentId === null || typeof group.parentId === "string");
    if (group.parentId !== null) identifier(group.parentId);
    requireThat(plain(group.metadata));
    requireThat(!groups.has(group.id));
    groups.set(group.id, group as GroupRecord);
  }
  unique(value.groups.map((group: GroupRecord) => `${group.parentId ?? ""}\0${group.slug.toLowerCase()}`));
  for (const group of groups.values()) {
    if (group.kind === "organization") requireThat(group.parentId === null);
    else {
      const parent = group.parentId === null ? undefined : groups.get(group.parentId);
      requireThat(parent !== undefined);
      requireThat(
        group.kind === "area"
          ? ["organization", "area"].includes(parent.kind)
          : ["organization", "area"].includes(parent.kind),
      );
    }
    const seen = new Set<string>();
    let cursor: GroupRecord | undefined = group;
    while (cursor) {
      requireThat(!seen.has(cursor.id) && seen.size < 32);
      seen.add(cursor.id);
      cursor = cursor.parentId === null ? undefined : groups.get(cursor.parentId);
    }
  }

  const sourceIds = new Set<string>();
  for (const source of value.sources) {
    objectKeys(source, [
      "id",
      "provider",
      "owner",
      "ownerType",
      "include",
      "exclude",
      "proposedDefaultGroupId",
      "metadata",
    ]);
    identifier(source.id);
    requireThat(!sourceIds.has(source.id));
    sourceIds.add(source.id);
    requireThat(source.provider === "github");
    requireThat(
      typeof source.owner === "string" && /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(source.owner),
    );
    requireThat(["organization", "user"].includes(source.ownerType));
    for (const key of ["include", "exclude"] as const) {
      requireThat(Array.isArray(source[key]) && source[key].length <= 10_000);
      source[key].forEach((item: unknown) => displayName(item));
      unique(source[key]);
    }
    requireThat(
      source.proposedDefaultGroupId === null || groups.has(source.proposedDefaultGroupId),
    );
    requireThat(plain(source.metadata));
  }

  const repositoryIds = new Set<string>();
  const canonicalIdentities: string[] = [];
  for (const repository of value.repositories) {
    objectKeys(repository, [
      "id",
      "remote",
      "sourceId",
      "primaryGroupId",
      "memberOf",
      "aliases",
      "classification",
      "metadata",
    ]);
    identifier(repository.id);
    requireThat(!repositoryIds.has(repository.id));
    repositoryIds.add(repository.id);
    requireThat(typeof repository.remote === "string");
    canonicalIdentities.push(canonicalRemote(repository.remote));
    requireThat(repository.sourceId === null || sourceIds.has(repository.sourceId));
    requireThat(repository.primaryGroupId === null || groups.has(repository.primaryGroupId));
    requireThat(Array.isArray(repository.memberOf) && repository.memberOf.length <= 1_000);
    const rootOrganizationId = (groupId: string): string => {
      let current = groups.get(groupId);
      requireThat(current !== undefined);
      while (current.parentId !== null) {
        const parent = groups.get(current.parentId);
        requireThat(parent !== undefined);
        current = parent;
      }
      requireThat(current.kind === "organization");
      return current.id;
    };
    const primaryRoot = repository.primaryGroupId === null
      ? null
      : rootOrganizationId(repository.primaryGroupId);
    repository.memberOf.forEach((groupId: unknown) => {
      identifier(groupId);
      requireThat(groups.get(groupId)?.kind === "project");
      requireThat(groupId !== repository.primaryGroupId);
      if (primaryRoot !== null) requireThat(rootOrganizationId(groupId) === primaryRoot);
    });
    unique(repository.memberOf);
    requireThat(Array.isArray(repository.aliases) && repository.aliases.length <= 1_000);
    repository.aliases.forEach((alias: unknown) => displayName(alias));
    unique(repository.aliases.map((alias: string) => alias.toLowerCase()));
    requireThat(["confirmed", "suggested", "unclassified"].includes(repository.classification));
    if (repository.classification === "unclassified") requireThat(repository.primaryGroupId === null);
    requireThat(plain(repository.metadata));
  }
  unique(canonicalIdentities);
  value.policies = value.policies.map(validatePolicyRecord);
  value.workflows = value.workflows.map(validateWorkflowRecord);
  unique(value.policies.map((record: PolicyRecord) => `${record.scope.kind}\0${record.scope.id}`));
  unique(value.workflows.map((record: WorkflowRecord) => `${record.scope.kind}\0${record.scope.id}\0${record.id}`));
  const legalScope = (scope: PolicyRecord["scope"]): boolean => {
    if (scope.kind === "base" || scope.kind === "user") return true;
    if (scope.kind === "repository") return repositoryIds.has(scope.id);
    if (scope.kind === "organization" || scope.kind === "area" || scope.kind === "project")
      return groups.get(scope.id)?.kind === scope.kind;
    return false;
  };
  requireThat(value.policies.every((record: PolicyRecord) => legalScope(record.scope)), "INVALID_CONFIG");
  requireThat(value.workflows.every((record: WorkflowRecord) => legalScope(record.scope)), "INVALID_CONFIG");
  return value as CatalogDocument;
}

function requireEmptyArray(value: unknown): asserts value is [] {
  requireThat(Array.isArray(value) && value.length === 0, "UNSUPPORTED");
}

function validateCatalogOperation(input: unknown): void {
  requireThat(plain(input));
  const value = input as Record<string, any>;
  if (value.type === "group-create") {
    objectKeys(value, ["type", "group"]);
    objectKeys(value.group, ["id", "kind", "name", "slug", "parentId", "metadata"]);
    identifier(value.group.id);
    requireThat(["organization", "area", "project"].includes(value.group.kind));
    displayName(value.group.name);
    slug(value.group.slug);
    requireThat(value.group.parentId === null || typeof value.group.parentId === "string");
    if (value.group.parentId !== null) identifier(value.group.parentId);
    requireThat(plain(value.group.metadata));
  } else if (value.type === "group-update") {
    objectKeys(value, ["type", "id"], ["name", "slug"]);
    identifier(value.id);
    requireThat(value.name !== undefined || value.slug !== undefined);
    if (value.name !== undefined) displayName(value.name);
    if (value.slug !== undefined) slug(value.slug);
  } else if (value.type === "group-reparent") {
    objectKeys(value, ["type", "id", "parentId"]);
    identifier(value.id);
    identifier(value.parentId);
  } else if (value.type === "repo-membership") {
    objectKeys(value, ["type", "id", "projectId", "action"]);
    identifier(value.id);
    identifier(value.projectId);
    requireThat(["add", "remove"].includes(value.action));
  } else if (value.type === "repo-classify") {
    objectKeys(value, ["type", "id", "decision"], ["groupId"]);
    identifier(value.id);
    requireThat(["accept", "reject"].includes(value.decision));
    requireThat(value.decision === "accept" ? typeof value.groupId === "string" : value.groupId === undefined);
    if (value.groupId !== undefined) identifier(value.groupId);
  } else {
    throw new GovernanceError("INVALID_CONFIG");
  }
}

function validateCatalogChangeRequest(input: unknown): void {
  requireThat(plain(input));
  const value = input as Record<string, any>;
  const draftBacked = Object.hasOwn(value, "draftPath");
  const portableBacked = Object.hasOwn(value, "portablePath");
  requireThat(!(draftBacked && portableBacked), "INVALID_CONFIG");
  objectKeys(
    value,
    draftBacked
      ? ["configPath", "draftPath", "plansDirectory", "catalogChange"]
      : portableBacked
        ? ["configPath", "portablePath", "portableDigest", "plansDirectory", "catalogChange"]
        : ["configPath", "plansDirectory", "operation", "catalogChange"],
  );
  absolutePath(value.configPath);
  absolutePath(value.plansDirectory);
  if (draftBacked) absolutePath(value.draftPath);
  else if (portableBacked) {
    absolutePath(value.portablePath);
    requireThat(typeof value.portableDigest === "string" && /^sha256:[a-f0-9]{64}$/.test(value.portableDigest), "INVALID_CONFIG");
  } else validateCatalogOperation(value.operation);
  objectKeys(value.catalogChange, ["currentRevision", "nextRevision", "changedRecords"]);
  revision(value.catalogChange.currentRevision);
  revision(value.catalogChange.nextRevision, false);
  requireThat(Array.isArray(value.catalogChange.changedRecords) && value.catalogChange.changedRecords.length <= 22_001);
  for (const change of value.catalogChange.changedRecords) {
    objectKeys(change, ["section", "id", "before", "after"]);
    requireThat(["groups", "repositories", "sources", "policies", "workflows", "metadata"].includes(change.section));
    identifier(change.id);
  }
}

export function validateLocalStateDocument(input: unknown): LocalStateDocument {
  asJson(input);
  const value = cloneValidated(input) as Record<string, any>;
  objectKeys(value, [
    "schemaVersion",
    "documentType",
    "selectedConfig",
    "repositoryWorkspaces",
    "coordinationWorkspaces",
    "workspacePolicyOverlays",
    "trustedInputApprovals",
    "planReferences",
    "runReferences",
    "metadata",
  ], ["workspaceWorkflowOverlays", "hostActionReceipts"]);
  requireThat(
    value.schemaVersion === 2 && value.documentType === "workspacectl/local-state",
    "INVALID_CONFIG",
  );
  objectKeys(value.selectedConfig, ["path", "revision"]);
  absolutePath(value.selectedConfig.path);
  revision(value.selectedConfig.revision, false);
  requireThat(Array.isArray(value.repositoryWorkspaces) && value.repositoryWorkspaces.length <= 10_000);
  for (const workspace of value.repositoryWorkspaces) {
    objectKeys(workspace, [
      "id", "kind", "repositoryId", "path", "branch", "primarySelected", "hostLinks",
    ]);
    identifier(workspace.id);
    requireThat(["primary", "worktree"].includes(workspace.kind));
    identifier(workspace.repositoryId);
    absolutePath(workspace.path);
    requireThat(
      workspace.branch === null ||
        (typeof workspace.branch === "string" && workspace.branch.length > 0 &&
          workspace.branch.length <= 1024 && !/[\x00-\x1f]/.test(workspace.branch)),
    );
    requireThat(typeof workspace.primarySelected === "boolean");
    requireThat(!workspace.primarySelected || workspace.kind === "primary");
    objectKeys(workspace.hostLinks, [], ["hermesProjectId"]);
    if (workspace.hostLinks.hermesProjectId !== undefined) identifier(workspace.hostLinks.hermesProjectId);
  }
  unique(value.repositoryWorkspaces.map((workspace: RepositoryWorkspace) => workspace.id));
  unique(value.repositoryWorkspaces.map((workspace: RepositoryWorkspace) => workspace.path));
  requireThat(Array.isArray(value.coordinationWorkspaces) && value.coordinationWorkspaces.length <= 10_000);
  for (const workspace of value.coordinationWorkspaces) {
    objectKeys(workspace, ["id", "kind", "scope", "path", "memberRepositoryIds", "memberWorkspaceIds", "hostProjectId", "generatedFiles", "revision"]);
    identifier(workspace.id); requireThat(workspace.kind === "coordination");
    objectKeys(workspace.scope, ["kind", "id"]);
    requireThat(["organization", "area", "project"].includes(workspace.scope.kind)); identifier(workspace.scope.id);
    absolutePath(workspace.path);
    requireThat(Array.isArray(workspace.memberRepositoryIds) && workspace.memberRepositoryIds.length <= 10_000);
    workspace.memberRepositoryIds.forEach((entry: unknown) => identifier(entry)); unique(workspace.memberRepositoryIds);
    requireThat(Array.isArray(workspace.memberWorkspaceIds) && workspace.memberWorkspaceIds.length === workspace.memberRepositoryIds.length);
    workspace.memberWorkspaceIds.forEach((entry: unknown) => identifier(entry)); unique(workspace.memberWorkspaceIds);
    requireThat(workspace.hostProjectId === null || typeof workspace.hostProjectId === "string");
    if (workspace.hostProjectId !== null) identifier(workspace.hostProjectId);
    requireThat(Array.isArray(workspace.generatedFiles) && workspace.generatedFiles.length > 0 && workspace.generatedFiles.length <= 16);
    workspace.generatedFiles.forEach((entry: unknown) => requireThat(typeof entry === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry)));
    unique(workspace.generatedFiles); revision(workspace.revision, false);
  }
  unique(value.coordinationWorkspaces.map((workspace: CoordinationWorkspace) => workspace.id));
  unique(value.coordinationWorkspaces.map((workspace: CoordinationWorkspace) => workspace.path));
  if (value.hostActionReceipts !== undefined) {
    requireThat(Array.isArray(value.hostActionReceipts) && value.hostActionReceipts.length <= 10_000);
    for (const receipt of value.hostActionReceipts) {
      objectKeys(receipt, ["actionId", "actionDigest", "configRevision", "catalogRevision", "contextLocalStateRevision", "status"], ["resultDigest"]);
      requireThat(typeof receipt.actionId === "string" && /^host-action-[a-f0-9]{24}$/.test(receipt.actionId));
      requireThat(typeof receipt.actionDigest === "string" && /^[a-f0-9]{64}$/.test(receipt.actionDigest));
      revision(receipt.configRevision, false); revision(receipt.catalogRevision, false); revision(receipt.contextLocalStateRevision, false);
      requireThat(["pending", "consumed"].includes(receipt.status));
      requireThat(receipt.status === "pending" ? receipt.resultDigest === undefined : typeof receipt.resultDigest === "string" && /^[a-f0-9]{64}$/.test(receipt.resultDigest));
    }
    unique(value.hostActionReceipts.map((receipt: HostActionReceipt) => receipt.actionId));
  }
  for (const key of [
    "trustedInputApprovals",
    "planReferences",
    "runReferences",
  ]) requireEmptyArray(value[key]);
  requireThat(Array.isArray(value.workspacePolicyOverlays) && value.workspacePolicyOverlays.length <= 10_000);
  value.workspacePolicyOverlays = value.workspacePolicyOverlays.map(validatePolicyRecord);
  unique(value.workspacePolicyOverlays.map((record: PolicyRecord) => `${record.scope.kind}\0${record.scope.id}`));
  requireThat(value.workspacePolicyOverlays.every((record: PolicyRecord) =>
    record.scope.kind === "workspace" && value.repositoryWorkspaces.some((workspace: RepositoryWorkspace) => workspace.id === record.scope.id)
  ), "INVALID_CONFIG");
  value.workspaceWorkflowOverlays ??= [];
  requireThat(Array.isArray(value.workspaceWorkflowOverlays) && value.workspaceWorkflowOverlays.length <= 10_000, "INVALID_CONFIG");
  value.workspaceWorkflowOverlays = value.workspaceWorkflowOverlays.map(validateWorkflowRecord);
  unique(value.workspaceWorkflowOverlays.map((record: WorkflowRecord) => `${record.scope.kind}\0${record.scope.id}\0${record.id}`));
  requireThat(value.workspaceWorkflowOverlays.every((record: WorkflowRecord) =>
    record.scope.kind === "workspace" && value.repositoryWorkspaces.some((workspace: RepositoryWorkspace) => workspace.id === record.scope.id)
  ), "INVALID_CONFIG");
  requireThat(plain(value.metadata));
  return value as LocalStateDocument;
}

function validateLocalStateChange(value: unknown): void {
  objectKeys(value, ["currentRevision", "nextRevision"]);
  revision(value.currentRevision, false);
  revision(value.nextRevision, false);
}

function validateWorkspacePrimaryRequest(value: unknown): void {
  objectKeys(value, [
    "configPath", "plansDirectory", "repositoryId", "workspaceId", "localStateChange",
  ]);
  absolutePath(value.configPath);
  absolutePath(value.plansDirectory);
  identifier(value.repositoryId);
  identifier(value.workspaceId);
  validateLocalStateChange(value.localStateChange);
}

function validateAdoptRequest(value: unknown): void {
  objectKeys(value, [
    "configPath", "plansDirectory", "repositoryId", "path", "workspaceId", "observation",
    "localStateChange",
  ]);
  absolutePath(value.configPath);
  absolutePath(value.plansDirectory);
  identifier(value.repositoryId);
  absolutePath(value.path);
  identifier(value.workspaceId);
  objectKeys(value.observation, [
    "path", "remote", "head", "branch", "dirty", "worktree", "statusDigest",
  ]);
  absolutePath(value.observation.path);
  requireThat(value.observation.path === value.path);
  requireThat(
    typeof value.observation.remote === "string" &&
      canonicalRemote(value.observation.remote) === value.observation.remote,
  );
  requireThat(
    value.observation.head === null ||
      (typeof value.observation.head === "string" && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value.observation.head)),
  );
  requireThat(
    value.observation.branch === null ||
      (typeof value.observation.branch === "string" && value.observation.branch.length > 0 &&
        value.observation.branch.length <= 1024 && !/[\x00-\x1f]/.test(value.observation.branch)),
  );
  requireThat(typeof value.observation.dirty === "boolean");
  requireThat(typeof value.observation.worktree === "boolean");
  requireThat(
    typeof value.observation.statusDigest === "string" && /^[a-f0-9]{64}$/.test(value.observation.statusDigest),
  );
  validateLocalStateChange(value.localStateChange);
}

function validateCoordinationCreateRequest(value: unknown): void {
  objectKeys(value, ["configPath", "plansDirectory", "groupId", "path", "workspaceId", "files", "binding", "localStateChange"]);
  absolutePath(value.configPath); absolutePath(value.plansDirectory); identifier(value.groupId); absolutePath(value.path); identifier(value.workspaceId);
  requireThat(Array.isArray(value.files) && value.files.length > 0 && value.files.length <= 16);
  for (const file of value.files) {
    objectKeys(file, ["name", "content", "sha256"]);
    requireThat(typeof file.name === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(file.name));
    requireThat(typeof file.content === "string" && Buffer.byteLength(file.content) <= 256 * 1024);
    requireThat(typeof file.sha256 === "string" && /^[a-f0-9]{64}$/.test(file.sha256) && digest(file.content) === file.sha256);
  }
  unique(value.files.map((file: { name: string }) => file.name));
  requireThat(plain(value.binding) && value.binding.id === value.workspaceId && value.binding.path === value.path);
  validateLocalStateChange(value.localStateChange);
}

function validateCheckoutResolved(value: unknown): void {
  objectKeys(value, ["kind", "name", "commit"]);
  requireThat(["branch", "tag", "commit"].includes(value.kind));
  requireThat(value.name === null || (typeof value.name === "string" && value.name.length > 0 && value.name.length <= 1024 && !/[\x00-\x1f]/.test(value.name)));
  requireThat((value.kind === "commit") === (value.name === null));
  requireThat(typeof value.commit === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.commit));
}

function validateCheckoutRequest(value: Record<string, any>, reconcile: boolean): void {
  objectKeys(value, reconcile
    ? ["configPath", "plansDirectory", "operationId", "repositoryId", "remote", "destination", "stagingPath", "workspaceId", "resolved", "localStateChange"]
    : ["configPath", "plansDirectory", "repositoryId", "remote", "requestedRef", "resolved", "destination", "stagingPath", "operationId", "workspaceId", "localStateChange"]);
  absolutePath(value.configPath); absolutePath(value.plansDirectory); absolutePath(value.destination); absolutePath(value.stagingPath);
  identifier(value.repositoryId); identifier(value.operationId); identifier(value.workspaceId);
  requireThat(typeof value.remote === "string" && canonicalRemote(value.remote) === value.remote);
  if (!reconcile) requireThat(typeof value.requestedRef === "string" && value.requestedRef.length > 0 && value.requestedRef.length <= 1100 && !/[\x00-\x1f]/.test(value.requestedRef));
  validateCheckoutResolved(value.resolved);
  validateLocalStateChange(value.localStateChange);
}

function validateMoveIdentity(value: unknown): void {
  objectKeys(value, ["remote", "head", "branch", "statusDigest", "device"]);
  requireThat(typeof value.remote === "string" && canonicalRemote(value.remote) === value.remote);
  requireThat(typeof value.head === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.head));
  requireThat(value.branch === null || (typeof value.branch === "string" && value.branch.length > 0 && value.branch.length <= 1024 && !/[\x00-\x1f]/.test(value.branch)));
  requireThat(typeof value.statusDigest === "string" && /^[a-f0-9]{64}$/.test(value.statusDigest));
  requireThat(typeof value.device === "string" && /^\d+$/.test(value.device));
}

function validateMoveRequest(value: Record<string, any>, reconcile: boolean): void {
  objectKeys(value, reconcile
    ? ["configPath", "plansDirectory", "operationId", "repositoryId", "workspaceId", "source", "destination", "identity", "localStateChange"]
    : ["configPath", "plansDirectory", "operationId", "repositoryId", "workspaceId", "source", "destination", "confirmInactive", "identity", "localStateChange"]);
  for (const path of [value.configPath, value.plansDirectory, value.source, value.destination]) absolutePath(path);
  for (const id of [value.operationId, value.repositoryId, value.workspaceId]) identifier(id);
  if (!reconcile) requireThat(value.confirmInactive === true);
  validateMoveIdentity(value.identity);
  validateLocalStateChange(value.localStateChange);
}

export function validateWorktreeBranch(value: unknown): asserts value is string {
  requireThat(
    typeof value === "string" && value.length > 0 && value.length <= 1024 &&
      !value.startsWith("-") && !/[\x00-\x20\x7f~^:?*[\\]/.test(value) &&
      !value.includes("..") && !value.includes("@{") && !value.endsWith(".") &&
      value.split("/").every((component) => component.length > 0 && !component.startsWith(".") && !component.endsWith(".lock")),
    "INVALID_CONFIG",
  );
}

function validateWorktreeRequest(value: Record<string, any>, remove: boolean): void {
  objectKeys(value, remove
    ? ["configPath", "plansDirectory", "operationId", "repositoryId", "workspaceId", "primaryPath", "path", "branch", "baseCommit", "confirmInactive", "commonDirectory", "localStateChange"]
    : ["configPath", "plansDirectory", "operationId", "repositoryId", "remote", "primaryPath", "primaryWorkspaceId", "baseCommit", "branch", "path", "workspaceId", "localStateChange"]);
  for (const path of [value.configPath, value.plansDirectory, value.primaryPath, value.path]) absolutePath(path);
  for (const id of [value.operationId, value.repositoryId, value.workspaceId]) identifier(id);
  if (!remove) {
    identifier(value.primaryWorkspaceId);
    requireThat(typeof value.remote === "string" && canonicalRemote(value.remote) === value.remote);
  } else {
    absolutePath(value.commonDirectory);
    requireThat(value.confirmInactive === true);
  }
  validateWorktreeBranch(value.branch);
  requireThat(typeof value.baseCommit === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.baseCommit));
  validateLocalStateChange(value.localStateChange);
}

export function validateWorkspacePlan(input: unknown): WorkspacePlan {
  asJson(input);
  const value = cloneValidated(input) as Record<string, any>;
  objectKeys(value, [
    "schemaVersion",
    "format",
    "id",
    "kind",
    "createdAt",
    "inputRevisions",
    "repositoryIds",
    "request",
    "actions",
    "preconditions",
    "expectedOutputs",
    "approvalsRequired",
    "semanticDigest",
  ]);
  requireThat(value.schemaVersion === 2 && value.format === "workspacectl-plan/1");
  requireThat(["init", "import-v1", "catalog-edit", "workspace-edit", "workspace-primary", "adopt", "coordination-create", "checkout", "checkout-reconcile", "checkout-move", "checkout-move-reconcile", "worktree-create", "worktree-remove"].includes(value.kind));
  requireThat(
    typeof value.createdAt === "string" &&
      !Number.isNaN(Date.parse(value.createdAt)) &&
      new Date(value.createdAt).toISOString() === value.createdAt,
  );
  requireThat(typeof value.semanticDigest === "string" && /^[a-f0-9]{64}$/.test(value.semanticDigest));
  requireThat(value.id === `plan-${value.semanticDigest.slice(0, 32)}`);

  objectKeys(value.inputRevisions, ["config", "catalog", "localState", "sources"]);
  revision(value.inputRevisions.config);
  revision(value.inputRevisions.catalog);
  revision(value.inputRevisions.localState);
  requireThat(plain(value.inputRevisions.sources));
  for (const [key, sourceRevision] of Object.entries(value.inputRevisions.sources)) {
    identifier(key);
    requireThat(typeof sourceRevision === "string" && /^[a-f0-9]{64}$/.test(sourceRevision));
  }
  requireThat(Array.isArray(value.repositoryIds) && value.repositoryIds.length <= 10_000);
  value.repositoryIds.forEach((repositoryId: unknown) => identifier(repositoryId));
  unique(value.repositoryIds);
  requireThat(plain(value.request));
  if (value.kind === "catalog-edit") validateCatalogChangeRequest(value.request);
  if (value.kind === "workspace-edit") {
    objectKeys(value.request, ["configPath", "draftPath", "plansDirectory", "workspaceId", "localStateChange"]);
    absolutePath(value.request.configPath); absolutePath(value.request.draftPath); absolutePath(value.request.plansDirectory);
    identifier(value.request.workspaceId); validateLocalStateChange(value.request.localStateChange);
  }
  if (value.kind === "workspace-primary") validateWorkspacePrimaryRequest(value.request);
  if (value.kind === "adopt") validateAdoptRequest(value.request);
  if (value.kind === "coordination-create") validateCoordinationCreateRequest(value.request);
  if (value.kind === "checkout") validateCheckoutRequest(value.request, false);
  if (value.kind === "checkout-reconcile") validateCheckoutRequest(value.request, true);
  if (value.kind === "checkout-move") validateMoveRequest(value.request, false);
  if (value.kind === "checkout-move-reconcile") validateMoveRequest(value.request, true);
  if (value.kind === "worktree-create") validateWorktreeRequest(value.request, false);
  if (value.kind === "worktree-remove") validateWorktreeRequest(value.request, true);

  requireThat(Array.isArray(value.actions) && value.actions.length > 0 && value.actions.length <= 8);
  for (const action of value.actions) {
    identifier(action.id);
    if (action.type === "document-cas") {
      objectKeys(action, ["id", "type", "target", "path", "expectedRevision", "nextRevision"]);
      requireThat(["config", "catalog", "local-state"].includes(action.target));
      absolutePath(action.path); revision(action.expectedRevision); revision(action.nextRevision, false);
    } else if (action.type === "directory-create") {
      objectKeys(action, ["id", "type", "path"]); absolutePath(action.path);
    } else if (action.type === "file-create") {
      objectKeys(action, ["id", "type", "path", "sha256"]); absolutePath(action.path);
      requireThat(typeof action.sha256 === "string" && /^[a-f0-9]{64}$/.test(action.sha256));
    } else if (["git-clone", "directory-publish", "directory-rename", "git-worktree-add", "git-worktree-remove"].includes(action.type)) {
      objectKeys(action, ["id", "type", "path"]); absolutePath(action.path);
    } else throw new GovernanceError("INVALID_CONFIG");
  }
  unique(value.actions.map((action: PlanAction) => action.id));

  requireThat(Array.isArray(value.preconditions) && value.preconditions.length <= 16);
  for (const condition of value.preconditions) {
    objectKeys(condition, ["id", "type", "target", "expected"]);
    identifier(condition.id);
    requireThat(["revision", "source-digest"].includes(condition.type));
    identifier(condition.target);
    requireThat(typeof condition.expected === "string" && condition.expected.length <= 256);
  }
  unique(value.preconditions.map((condition: PlanPrecondition) => condition.id));

  requireThat(Array.isArray(value.expectedOutputs) && value.expectedOutputs.length <= 8);
  for (const output of value.expectedOutputs) {
    objectKeys(output, ["id", "type", "target", "revision"]);
    identifier(output.id);
    requireThat(output.type === "document");
    requireThat(["config", "catalog", "local-state"].includes(output.target));
    revision(output.revision, false);
  }
  unique(value.expectedOutputs.map((output: PlanExpectedOutput) => output.id));
  if (value.kind === "catalog-edit") {
    const change = value.request.catalogChange as Record<string, unknown>;
    const action = value.actions.find((candidate: PlanAction) => candidate.target === "catalog");
    const output = value.expectedOutputs.find((candidate: PlanExpectedOutput) => candidate.target === "catalog");
    requireThat(
      change.currentRevision === value.inputRevisions.catalog &&
        action?.expectedRevision === change.currentRevision &&
        action?.nextRevision === change.nextRevision &&
        output?.revision === change.nextRevision,
    );
  }
  requireThat(
    Array.isArray(value.approvalsRequired) &&
      value.approvalsRequired.length === 1,
  );
  objectKeys(value.approvalsRequired[0], ["id", "kind"]);
  requireThat(
    value.approvalsRequired[0].id === "apply" &&
      value.approvalsRequired[0].kind === "explicit-plan-id",
  );
  return value as WorkspacePlan;
}

export function documentRevision(document: unknown): string {
  return `sha256:${digest(document)}`;
}

export function emptyCatalogDocument(): CatalogDocument {
  return {
    schemaVersion: 2,
    documentType: "workspacectl/catalog",
    groups: [],
    repositories: [],
    sources: [],
    policies: [],
    workflows: [],
    metadata: {},
  };
}

export function emptyLocalStateDocument(
  configPath: string,
  configRevision: string,
): LocalStateDocument {
  const document: LocalStateDocument = {
    schemaVersion: 2,
    documentType: "workspacectl/local-state",
    selectedConfig: { path: configPath, revision: configRevision },
    repositoryWorkspaces: [],
    coordinationWorkspaces: [],
    workspacePolicyOverlays: [],
    workspaceWorkflowOverlays: [],
    trustedInputApprovals: [],
    planReferences: [],
    runReferences: [],
    metadata: {},
  };
  return validateLocalStateDocument(document);
}

export function workspacePlanSemanticFields(plan: WorkspacePlan): Record<string, Json> {
  return {
    kind: plan.kind,
    inputRevisions: plan.inputRevisions,
    repositoryIds: plan.repositoryIds,
    request: plan.request,
    actions: plan.actions,
    preconditions: plan.preconditions,
    expectedOutputs: plan.expectedOutputs,
    approvalsRequired: plan.approvalsRequired,
  } as unknown as Record<string, Json>;
}
