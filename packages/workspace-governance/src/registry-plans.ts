import {
  lstat,
  mkdir,
  open,
  readFile,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { canonicalJson, canonicalRemote, digest, GovernanceError, requireThat } from "./core.ts";
import type { Json } from "./core.ts";
import {
  FileCatalogStore,
  FileConfigStore,
  FileLocalStateStore,
  StoreAdapterRegistry,
  createBuiltinStoreRegistry,
  requireMutationAuthority,
  writeCatalogDocument,
  writeConfigDocument,
  writeLocalStateDocument,
} from "./document-stores.ts";
import {
  ABSENT_REVISION,
  MAX_DOCUMENT_BYTES,
  documentRevision,
  emptyCatalogDocument,
  emptyLocalStateDocument,
  parseDataText,
  validateCatalogDocument,
  validateLocalStateDocument,
  validateWorkspacePlan,
  workspacePlanSemanticFields,
} from "./v2-model.ts";
import type {
  CatalogDocument,
  CoordinationWorkspace,
  LocalStateDocument,
  WorkspacePlan,
  WorkspacesConfig,
} from "./v2-model.ts";
import { convertV1Catalog } from "./v1-import.ts";
import { requireStablePath } from "./path-safety.ts";
import { validateCatalogDraft, validateLocalStateDraft } from "./catalog-readback.ts";
import type { CatalogDraft, LocalStateDraft } from "./catalog-readback.ts";
import { contained, discoverLocal } from "./discovery.ts";
import { assertCatalogRulesResolvable, assertWorkspaceRulesResolvable } from "./v2-context.ts";
import { applyCheckoutPlan, applyCheckoutReconcilePlan } from "./checkout-operations.ts";
import { applyMovePlan, applyMoveReconcilePlan } from "./move-operations.ts";
import { applyWorktreePlan, saveWorktreePlanAuthority } from "./worktree-operations.ts";

export interface InitRequest {
  configPath: string;
  catalogPath: string;
  localStatePath: string;
  plansDirectory: string;
  trustedRoots: string[];
}

export interface ImportRequest {
  configPath: string;
  manifestPath: string;
  unclassifiedPath: string;
}

export interface CatalogChangeRequest {
  configPath: string;
  draftPath: string;
}

export interface PrimarySelectionRequest {
  configPath: string;
  repositoryId: string;
  workspaceId: string;
}

export interface AdoptRequest {
  configPath: string;
  repositoryId: string;
  path: string;
}

export interface CoordinationCreateRequest {
  configPath: string;
  groupId: string;
  path: string;
}

export type CatalogEditOperation =
  | {
      type: "group-create";
      group: {
        id: string;
        kind: "organization" | "area" | "project";
        name: string;
        slug: string;
        parentId: string | null;
        metadata: Record<string, Json>;
      };
    }
  | { type: "group-update"; id: string; name?: string; slug?: string }
  | { type: "group-reparent"; id: string; parentId: string }
  | { type: "repo-membership"; id: string; projectId: string; action: "add" | "remove" }
  | { type: "repo-classify"; id: string; decision: "accept" | "reject"; groupId?: string };

interface ImportCounts {
  classified: number;
  unclassified: number;
  total: number;
}

export interface AppliedRegistryPlan {
  planId: string;
  kind: "init" | "import-v1" | "catalog-edit" | "workspace-edit" | "workspace-primary" | "adopt" | "coordination-create" | "checkout" | "checkout-reconcile" | "worktree-create" | "worktree-remove";
  revisions: {
    config: string;
    catalog: string;
    localState: string;
  };
  readback: {
    config: WorkspacesConfig;
    catalog: CatalogDocument;
    localState: LocalStateDocument;
  };
  transition?: {
    type: "classification";
    repositoryId: string;
    decision: "accepted" | "rejected";
    primaryGroupId: string | null;
  };
}

export interface ApplyOptions {
  selectedConfigPath: string;
  approval?: string;
  storeRegistry?: StoreAdapterRegistry;
  testHooks?: {
    beforeCatalogFinalSnapshot?: () => Promise<void>;
    afterCatalogWriteBeforeReadback?: () => Promise<void>;
    beforeCoordinationDirectoryCreate?: () => Promise<void>;
    afterCoordinationLocalStateWriteBeforeReadback?: () => Promise<void>;
  };
}

const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

function exactKeys(
  value: unknown,
  keys: readonly string[],
  optional: readonly string[] = [],
): asserts value is Record<string, unknown> {
  requireThat(
    plain(value) &&
      keys.every((key) => Object.hasOwn(value, key)) &&
      Object.keys(value).every((key) => keys.includes(key) || optional.includes(key)),
    "INVALID_CONFIG",
  );
}

function catalogEditOperation(input: unknown): CatalogEditOperation {
  requireThat(plain(input) && typeof input.type === "string", "INVALID_CONFIG");
  const identifier = (value: unknown) => requireThat(
    typeof value === "string" && value.length > 0 && value.length <= 256 &&
      !/[\x00-\x1f/\\]/.test(value) &&
      !["__proto__", "prototype", "constructor"].includes(value),
    "INVALID_CONFIG",
  );
  if (input.type === "group-create") {
    exactKeys(input, ["type", "group"]);
    exactKeys(input.group, ["id", "kind", "name", "slug", "parentId", "metadata"]);
    identifier(input.group.id);
    requireThat(["organization", "area", "project"].includes(input.group.kind as string), "INVALID_CONFIG");
    requireThat(typeof input.group.name === "string" && typeof input.group.slug === "string", "INVALID_CONFIG");
    requireThat(input.group.parentId === null || typeof input.group.parentId === "string", "INVALID_CONFIG");
    if (input.group.parentId !== null) identifier(input.group.parentId);
    requireThat(plain(input.group.metadata), "INVALID_CONFIG");
  } else if (input.type === "group-update") {
    exactKeys(input, ["type", "id"], ["name", "slug"]);
    identifier(input.id);
    requireThat(
      (typeof input.name === "string" || typeof input.slug === "string") &&
        (input.name === undefined || typeof input.name === "string") &&
        (input.slug === undefined || typeof input.slug === "string"),
      "INVALID_CONFIG",
    );
  } else if (input.type === "group-reparent") {
    exactKeys(input, ["type", "id", "parentId"]);
    identifier(input.id);
    identifier(input.parentId);
  } else if (input.type === "repo-membership") {
    exactKeys(input, ["type", "id", "projectId", "action"]);
    identifier(input.id);
    identifier(input.projectId);
    requireThat(["add", "remove"].includes(input.action as string), "INVALID_CONFIG");
  } else if (input.type === "repo-classify") {
    exactKeys(input, ["type", "id", "decision"], ["groupId"]);
    identifier(input.id);
    requireThat(["accept", "reject"].includes(input.decision as string), "INVALID_CONFIG");
    requireThat(
      input.decision === "accept"
        ? typeof input.groupId === "string"
        : input.groupId === undefined,
      "INVALID_CONFIG",
    );
    if (input.groupId !== undefined) identifier(input.groupId);
  } else {
    throw new GovernanceError("INVALID_CONFIG");
  }
  try {
    canonicalJson(input);
  } catch {
    throw new GovernanceError("INVALID_CONFIG");
  }
  return structuredClone(input) as unknown as CatalogEditOperation;
}

function initRequest(input: unknown): InitRequest {
  exactKeys(input, [
    "configPath",
    "catalogPath",
    "localStatePath",
    "plansDirectory",
    "trustedRoots",
  ]);
  const request = structuredClone(input) as unknown as InitRequest;
  const config: WorkspacesConfig = {
    schemaVersion: 2,
    documentType: "workspacectl/config",
    catalog: { adapter: "file", path: request.catalogPath },
    localState: { adapter: "file", path: request.localStatePath },
    plans: { directory: request.plansDirectory },
    trustedRoots: request.trustedRoots,
  };
  // The document validator owns absolute, distinct, bounded path checks.
  const validated = validateConfiguration(config);
  requireThat(request.configPath === resolve(request.configPath), "INVALID_CONFIG");
  requireThat(
    [
      request.configPath,
      validated.catalog.path,
      validated.localState.path,
    ].every((path, index, paths) => paths.indexOf(path) === index),
    "INVALID_CONFIG",
  );
  return {
    configPath: request.configPath,
    catalogPath: validated.catalog.path,
    localStatePath: validated.localState.path,
    plansDirectory: validated.plans.directory,
    trustedRoots: validated.trustedRoots,
  };
}

import { validateConfigDocument as validateConfiguration } from "./v2-model.ts";

async function requireRealDirectory(path: string): Promise<void> {
  try {
    await requireStablePath(path);
    const status = await lstat(path);
    requireThat(status.isDirectory() && !status.isSymbolicLink(), "INVALID_CONFIG");
  } catch (error) {
    if (error instanceof GovernanceError) throw error;
    throw new GovernanceError("INVALID_CONFIG");
  }
}

async function requireAbsent(path: string): Promise<void> {
  try {
    await requireStablePath(path, { allowMissing: true });
    await lstat(path);
    throw new GovernanceError("CONFLICT");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
    if (error instanceof GovernanceError) throw error;
    throw new GovernanceError("ACTION_FAILED");
  }
}

async function validateInitFilesystem(request: InitRequest): Promise<void> {
  await Promise.all([
    requireRealDirectory(dirname(request.configPath)),
    requireRealDirectory(dirname(request.catalogPath)),
    requireRealDirectory(dirname(request.localStatePath)),
    requireRealDirectory(request.plansDirectory),
    ...request.trustedRoots.map(requireRealDirectory),
  ]);
}

function configFor(request: InitRequest): WorkspacesConfig {
  return validateConfiguration({
    schemaVersion: 2,
    documentType: "workspacectl/config",
    catalog: { adapter: "file", path: request.catalogPath },
    localState: { adapter: "file", path: request.localStatePath },
    plans: { directory: request.plansDirectory },
    trustedRoots: request.trustedRoots,
  });
}

function finishPlan(
  plan: Omit<WorkspacePlan, "id" | "semanticDigest">,
): WorkspacePlan {
  const semantic = workspacePlanSemanticFields({
    ...plan,
    id: `plan-${"0".repeat(32)}`,
    semanticDigest: "0".repeat(64),
  });
  const semanticDigest = digest(semantic);
  return validateWorkspacePlan({
    ...plan,
    id: `plan-${semanticDigest.slice(0, 32)}`,
    semanticDigest,
  });
}

export function assertWorkspacePlanIntegrity(plan: WorkspacePlan): void {
  const validated = validateWorkspacePlan(plan);
  requireThat(
    digest(workspacePlanSemanticFields(validated)) === validated.semanticDigest,
    "STALE_PLAN",
  );
}

export async function createInitPlan(
  input: InitRequest,
  createdAt = new Date().toISOString(),
): Promise<WorkspacePlan> {
  const request = initRequest(input);
  await validateInitFilesystem(request);
  await Promise.all([
    requireAbsent(request.configPath),
    requireAbsent(request.catalogPath),
    requireAbsent(request.localStatePath),
  ]);

  const config = configFor(request);
  const catalog = emptyCatalogDocument();
  const localState = emptyLocalStateDocument(
    request.configPath,
    documentRevision(config),
  );
  const revisions = {
    config: documentRevision(config),
    catalog: documentRevision(catalog),
    localState: documentRevision(localState),
  };
  const action = (
    id: string,
    target: "config" | "catalog" | "local-state",
    path: string,
    nextRevision: string,
  ) => ({
    id,
    type: "document-cas" as const,
    target,
    path,
    expectedRevision: ABSENT_REVISION,
    nextRevision,
  });
  return finishPlan({
    schemaVersion: 2,
    format: "workspacectl-plan/1",
    kind: "init",
    createdAt,
    inputRevisions: {
      config: ABSENT_REVISION,
      catalog: ABSENT_REVISION,
      localState: ABSENT_REVISION,
      sources: {},
    },
    repositoryIds: [],
    request: request as unknown as Record<string, Json>,
    actions: [
      action("write-catalog", "catalog", request.catalogPath, revisions.catalog),
      action("write-local-state", "local-state", request.localStatePath, revisions.localState),
      action("write-config", "config", request.configPath, revisions.config),
    ],
    preconditions: [
      { id: "config-absent", type: "revision", target: "config", expected: ABSENT_REVISION },
      { id: "catalog-absent", type: "revision", target: "catalog", expected: ABSENT_REVISION },
      { id: "local-state-absent", type: "revision", target: "local-state", expected: ABSENT_REVISION },
    ],
    expectedOutputs: [
      { id: "catalog-created", type: "document", target: "catalog", revision: revisions.catalog },
      { id: "local-state-created", type: "document", target: "local-state", revision: revisions.localState },
      { id: "config-created", type: "document", target: "config", revision: revisions.config },
    ],
    approvalsRequired: [{ id: "apply", kind: "explicit-plan-id" }],
  });
}

interface LoadedImportSource {
  value: unknown;
  sha256: string;
}

async function readImportSource(path: string): Promise<LoadedImportSource> {
  requireThat(path === resolve(path), "INVALID_CONFIG");
  let handle;
  try {
    await requireStablePath(path);
    const pathStatus = await lstat(path);
    requireThat(
      pathStatus.isFile() &&
        !pathStatus.isSymbolicLink() &&
        pathStatus.size <= MAX_DOCUMENT_BYTES,
      "INVALID_CONFIG",
    );
    handle = await open(path, "r");
    const before = await handle.stat();
    requireThat(
      before.isFile() &&
        before.dev === pathStatus.dev &&
        before.ino === pathStatus.ino &&
        before.size <= MAX_DOCUMENT_BYTES,
      "INVALID_CONFIG",
    );
    const bytes = Buffer.alloc(MAX_DOCUMENT_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    const after = await handle.stat();
    requireThat(
      length <= MAX_DOCUMENT_BYTES &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs,
      "UNTRUSTED_INPUT",
    );
    const sourceBytes = bytes.subarray(0, length);
    const text = new TextDecoder("utf8", { fatal: true }).decode(sourceBytes);
    return {
      value: parseDataText(text, "json", MAX_DOCUMENT_BYTES),
      sha256: createHash("sha256").update(sourceBytes).digest("hex"),
    };
  } catch (error) {
    if (error instanceof GovernanceError) throw error;
    throw new GovernanceError("INVALID_CONFIG");
  } finally {
    await handle?.close();
  }
}

async function readCatalogDraft(path: string): Promise<{ draft: CatalogDraft; sha256: string }> {
  requireThat(path === resolve(path), "INVALID_CONFIG");
  const source = await readImportSource(path);
  return { draft: validateCatalogDraft(source.value), sha256: source.sha256 };
}

async function readLocalStateDraft(path: string): Promise<{ draft: LocalStateDraft; sha256: string }> {
  requireThat(path === resolve(path), "INVALID_CONFIG");
  const source = await readImportSource(path);
  return { draft: validateLocalStateDraft(source.value), sha256: source.sha256 };
}

export async function validateCatalogDraftFile(path: string): Promise<CatalogDraft> {
  const draft = (await readCatalogDraft(path)).draft;
  assertCatalogRulesResolvable(draft.document);
  return draft;
}

export async function validateConfigDraftFile(
  path: string,
  configPath: string,
  storeRegistry: StoreAdapterRegistry = createBuiltinStoreRegistry(),
): Promise<CatalogDraft | LocalStateDraft> {
  const source = await readImportSource(path);
  const target = (source.value as { target?: unknown })?.target;
  if (target === "workspace") {
    requireThat(configPath === resolve(configPath), "INVALID_CONFIG");
    const draft = validateLocalStateDraft(source.value);
    const loaded = await currentRegistryForLocalState(
      configPath,
      storeRegistry,
      false,
    );
    requireThat(draft.expectedRevision === loaded.localState.revision, "CONFLICT");
    assertWorkspaceRulesResolvable(loaded.catalog.document, draft.document, draft.workspaceId);
    return draft;
  }
  const draft = validateCatalogDraft(source.value);
  assertCatalogRulesResolvable(draft.document);
  return draft;
}

function catalogChangedRecords(current: CatalogDocument, next: CatalogDocument): Json[] {
  const changed: Json[] = [];
  for (const section of ["groups", "repositories", "sources", "policies", "workflows"] as const) {
    const recordId = (record: any): string => section === "policies"
      ? `${record.scope.kind}:${record.scope.id}`
      : section === "workflows"
        ? `${record.scope.kind}:${record.scope.id}:${record.id}`
        : record.id;
    const before = new Map(current[section].map((record) => [recordId(record), record]));
    const after = new Map(next[section].map((record) => [recordId(record), record]));
    for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const oldRecord = before.get(id) ?? null;
      const newRecord = after.get(id) ?? null;
      if (canonicalJson(oldRecord) !== canonicalJson(newRecord)) {
        changed.push({
          section,
          id,
          before: structuredClone(oldRecord) as Json,
          after: structuredClone(newRecord) as Json,
        });
      }
    }
  }
  if (canonicalJson(current.metadata) !== canonicalJson(next.metadata)) {
    changed.push({
      section: "metadata",
      id: "$document",
      before: structuredClone(current.metadata) as Json,
      after: structuredClone(next.metadata) as Json,
    });
  }
  return changed;
}

function catalogChangePlanCore(input: {
  configPath: string;
  plansDirectory: string;
  catalogPath: string;
  configRevision: string;
  catalogRevision: string;
  localStateRevision: string;
  currentCatalog: CatalogDocument;
  nextCatalog: CatalogDocument;
  sourceRevisions: Record<string, string>;
  sourceRequest: Record<string, Json>;
  createdAt: string;
}): WorkspacePlan {
  const nextRevision = documentRevision(input.nextCatalog);
  const catalogChange = {
    currentRevision: input.catalogRevision,
    nextRevision,
    changedRecords: catalogChangedRecords(input.currentCatalog, input.nextCatalog),
  };
  return finishPlan({
    schemaVersion: 2,
    format: "workspacectl-plan/1",
    kind: "catalog-edit",
    createdAt: input.createdAt,
    inputRevisions: {
      config: input.configRevision,
      catalog: input.catalogRevision,
      localState: input.localStateRevision,
      sources: input.sourceRevisions,
    },
    repositoryIds: input.nextCatalog.repositories.map((repository) => repository.id),
    request: {
      configPath: input.configPath,
      plansDirectory: input.plansDirectory,
      ...input.sourceRequest,
      catalogChange,
    },
    actions: [{
      id: "write-catalog-edit",
      type: "document-cas",
      target: "catalog",
      path: input.catalogPath,
      expectedRevision: input.catalogRevision,
      nextRevision,
    }],
    preconditions: [
      { id: "config-current", type: "revision", target: "config", expected: input.configRevision },
      { id: "catalog-current", type: "revision", target: "catalog", expected: input.catalogRevision },
      { id: "local-state-current", type: "revision", target: "local-state", expected: input.localStateRevision },
      ...Object.entries(input.sourceRevisions).map(([target, expected]) => ({
        id: `${target}-current`,
        type: "source-digest" as const,
        target,
        expected,
      })),
    ],
    expectedOutputs: [
      { id: "catalog-edited", type: "document", target: "catalog", revision: nextRevision },
    ],
    approvalsRequired: [{ id: "apply", kind: "explicit-plan-id" }],
  });
}

export async function createCatalogChangePlan(
  input: CatalogChangeRequest,
  createdAt = new Date().toISOString(),
  storeRegistry: StoreAdapterRegistry = createBuiltinStoreRegistry(),
): Promise<WorkspacePlan> {
  exactKeys(input, ["configPath", "draftPath"]);
  requireThat(
    input.configPath === resolve(input.configPath) && input.draftPath === resolve(input.draftPath),
    "INVALID_CONFIG",
  );
  const loadedConfig = await loadWorkspacesConfig(input.configPath);
  const config = loadedConfig.document;
  requireThat(
    ![input.configPath, config.catalog.path, config.localState.path].includes(input.draftPath),
    "INVALID_CONFIG",
  );
  const [catalog, localState, source] = await Promise.all([
    storeRegistry.createCatalog(config.catalog.adapter, config.catalog.path).read(),
    storeRegistry.createLocalState(config.localState.adapter, config.localState.path).read(),
    readCatalogDraft(input.draftPath),
  ]);
  requireMutationAuthority(catalog);
  requireThat(
    catalog.document !== null &&
      catalog.freshness === "current" &&
      localState.document !== null &&
      localState.freshness === "current" &&
      localState.document.selectedConfig.path === input.configPath &&
      localState.document.selectedConfig.revision === loadedConfig.revision,
    "UNTRUSTED_INPUT",
  );
  requireThat(source.draft.expectedRevision === catalog.revision, "CONFLICT");
  if (source.draft.target === "user") {
    const withoutUser = (document: CatalogDocument): CatalogDocument => ({ ...document, policies: document.policies.filter((record) => record.scope.kind !== "user"), workflows: document.workflows.filter((record) => record.scope.kind !== "user") });
    requireThat(canonicalJson(withoutUser(source.draft.document)) === canonicalJson(withoutUser(catalog.document)), "INVALID_CONFIG");
  }
  return catalogChangePlanCore({
    configPath: input.configPath,
    plansDirectory: config.plans.directory,
    catalogPath: config.catalog.path,
    configRevision: loadedConfig.revision,
    catalogRevision: catalog.revision,
    localStateRevision: localState.revision,
    currentCatalog: catalog.document,
    nextCatalog: source.draft.document,
    sourceRevisions: { draft: source.sha256 },
    sourceRequest: { draftPath: input.draftPath },
    createdAt,
  });
}

export async function createWorkspaceChangePlan(
  input: CatalogChangeRequest,
  createdAt = new Date().toISOString(),
  storeRegistry: StoreAdapterRegistry = createBuiltinStoreRegistry(),
): Promise<WorkspacePlan> {
  exactKeys(input, ["configPath", "draftPath"]);
  requireThat(input.configPath === resolve(input.configPath) && input.draftPath === resolve(input.draftPath), "INVALID_CONFIG");
  const loaded = await currentRegistryForLocalState(input.configPath, storeRegistry);
  requireThat(![input.configPath, loaded.config.document.catalog.path, loaded.config.document.localState.path].includes(input.draftPath), "INVALID_CONFIG");
  const source = await readLocalStateDraft(input.draftPath);
  requireThat(source.draft.expectedRevision === loaded.localState.revision, "CONFLICT");
  const workspace = loaded.localState.document.repositoryWorkspaces.find((item) => item.id === source.draft.workspaceId);
  requireThat(workspace !== undefined, "NOT_FOUND");
  const next = validateLocalStateDocument(source.draft.document);
  assertWorkspaceRulesResolvable(loaded.catalog.document, next, source.draft.workspaceId);
  const withoutWorkspace = (document: LocalStateDocument): LocalStateDocument => ({ ...document, workspacePolicyOverlays: document.workspacePolicyOverlays.filter((record) => record.scope.id !== source.draft.workspaceId), workspaceWorkflowOverlays: (document.workspaceWorkflowOverlays ?? []).filter((record) => record.scope.id !== source.draft.workspaceId) });
  requireThat(canonicalJson(withoutWorkspace(next)) === canonicalJson(withoutWorkspace(loaded.localState.document)), "INVALID_CONFIG");
  const nextRevision = documentRevision(next);
  return finishPlan({
    schemaVersion: 2, format: "workspacectl-plan/1", kind: "workspace-edit", createdAt,
    inputRevisions: { config: loaded.config.revision, catalog: loaded.catalog.revision, localState: loaded.localState.revision, sources: { draft: source.sha256 } },
    repositoryIds: [workspace.repositoryId],
    request: { configPath: input.configPath, draftPath: input.draftPath, plansDirectory: loaded.config.document.plans.directory, workspaceId: source.draft.workspaceId, localStateChange: { currentRevision: loaded.localState.revision, nextRevision } },
    actions: [{ id: "write-workspace-edit", type: "document-cas", target: "local-state", path: loaded.config.document.localState.path, expectedRevision: loaded.localState.revision, nextRevision }],
    preconditions: [
      { id: "config-current", type: "revision", target: "config", expected: loaded.config.revision },
      { id: "catalog-current", type: "revision", target: "catalog", expected: loaded.catalog.revision },
      { id: "local-state-current", type: "revision", target: "local-state", expected: loaded.localState.revision },
      { id: "draft-current", type: "source-digest", target: "draft", expected: source.sha256 },
    ],
    expectedOutputs: [{ id: "workspace-edited", type: "document", target: "local-state", revision: nextRevision }],
    approvalsRequired: [{ id: "apply", kind: "explicit-plan-id" }],
  });
}

function applyCatalogOperation(
  catalog: CatalogDocument,
  operation: CatalogEditOperation,
): CatalogDocument {
  const next = structuredClone(catalog);
  if (operation.type === "group-create") {
    next.groups.push(structuredClone(operation.group));
  } else if (operation.type === "group-update" || operation.type === "group-reparent") {
    const group = next.groups.find((candidate) => candidate.id === operation.id);
    requireThat(group !== undefined, "NOT_FOUND");
    if (operation.type === "group-update") {
      requireThat(operation.name !== undefined || operation.slug !== undefined, "INVALID_CONFIG");
      if (operation.name !== undefined) group.name = operation.name;
      if (operation.slug !== undefined) group.slug = operation.slug;
    } else {
      group.parentId = operation.parentId;
    }
  } else {
    const repository = next.repositories.find((candidate) => candidate.id === operation.id);
    requireThat(repository !== undefined, "NOT_FOUND");
    if (operation.type === "repo-membership") {
      requireThat(next.groups.some((group) => group.id === operation.projectId && group.kind === "project"), "INVALID_CONFIG");
      repository.memberOf = operation.action === "add"
        ? [...new Set([...repository.memberOf, operation.projectId])]
        : repository.memberOf.filter((id) => id !== operation.projectId);
    } else if (operation.decision === "accept") {
      requireThat(
        typeof operation.groupId === "string" && next.groups.some((group) => group.id === operation.groupId),
        "INVALID_CONFIG",
      );
      repository.primaryGroupId = operation.groupId;
      repository.classification = "confirmed";
    } else {
      requireThat(operation.groupId === undefined, "INVALID_CONFIG");
      requireThat(repository.classification === "suggested", "INVALID_CONFIG");
      repository.primaryGroupId = null;
      repository.classification = "unclassified";
    }
  }
  return validateCatalogDocument(next);
}

export async function createCatalogOperationPlan(
  configPath: string,
  operation: CatalogEditOperation,
  createdAt = new Date().toISOString(),
  storeRegistry: StoreAdapterRegistry = createBuiltinStoreRegistry(),
): Promise<WorkspacePlan> {
  requireThat(configPath === resolve(configPath), "INVALID_CONFIG");
  const validatedOperation = catalogEditOperation(operation);
  const loadedConfig = await loadWorkspacesConfig(configPath);
  const config = loadedConfig.document;
  const [catalog, localState] = await Promise.all([
    storeRegistry.createCatalog(config.catalog.adapter, config.catalog.path).read(),
    storeRegistry.createLocalState(config.localState.adapter, config.localState.path).read(),
  ]);
  requireMutationAuthority(catalog);
  requireThat(
    catalog.document !== null &&
      catalog.freshness === "current" &&
      localState.document !== null &&
      localState.freshness === "current" &&
      localState.document.selectedConfig.path === configPath &&
      localState.document.selectedConfig.revision === loadedConfig.revision,
    "UNTRUSTED_INPUT",
  );
  const next = applyCatalogOperation(catalog.document, validatedOperation);
  return catalogChangePlanCore({
    configPath,
    plansDirectory: config.plans.directory,
    catalogPath: config.catalog.path,
    configRevision: loadedConfig.revision,
    catalogRevision: catalog.revision,
    localStateRevision: localState.revision,
    currentCatalog: catalog.document,
    nextCatalog: next,
    sourceRevisions: {},
    sourceRequest: { operation: validatedOperation as unknown as Json },
    createdAt,
  });
}

function localStateChangePlanCore(input: {
  kind: "workspace-primary" | "adopt";
  configPath: string;
  plansDirectory: string;
  localStatePath: string;
  configRevision: string;
  catalogRevision: string;
  localStateRevision: string;
  repositoryId: string;
  request: Record<string, Json>;
  nextLocalState: LocalStateDocument;
  createdAt: string;
}): WorkspacePlan {
  const nextRevision = documentRevision(input.nextLocalState);
  return finishPlan({
    schemaVersion: 2,
    format: "workspacectl-plan/1",
    kind: input.kind,
    createdAt: input.createdAt,
    inputRevisions: {
      config: input.configRevision,
      catalog: input.catalogRevision,
      localState: input.localStateRevision,
      sources: {},
    },
    repositoryIds: [input.repositoryId],
    request: {
      configPath: input.configPath,
      plansDirectory: input.plansDirectory,
      ...input.request,
      localStateChange: {
        currentRevision: input.localStateRevision,
        nextRevision,
      },
    },
    actions: [{
      id: "write-local-state",
      type: "document-cas",
      target: "local-state",
      path: input.localStatePath,
      expectedRevision: input.localStateRevision,
      nextRevision,
    }],
    preconditions: [
      { id: "config-current", type: "revision", target: "config", expected: input.configRevision },
      { id: "catalog-current", type: "revision", target: "catalog", expected: input.catalogRevision },
      { id: "local-state-current", type: "revision", target: "local-state", expected: input.localStateRevision },
    ],
    expectedOutputs: [{
      id: "local-state-edited",
      type: "document",
      target: "local-state",
      revision: nextRevision,
    }],
    approvalsRequired: [{ id: "apply", kind: "explicit-plan-id" }],
  });
}

async function currentRegistryForLocalState(
  configPath: string,
  storeRegistry: StoreAdapterRegistry = createBuiltinStoreRegistry(),
  mutationAuthorityRequired = true,
) {
  const config = await loadWorkspacesConfig(configPath);
  const [catalog, localState] = await Promise.all([
    storeRegistry.createCatalog(
      config.document.catalog.adapter,
      config.document.catalog.path,
    ).read(),
    storeRegistry.createLocalState(
      config.document.localState.adapter,
      config.document.localState.path,
    ).read(),
  ]);
  if (mutationAuthorityRequired) requireMutationAuthority(localState);
  requireThat(
    catalog.document !== null && catalog.capabilities.read === true &&
      catalog.freshness === "current" &&
      localState.document !== null && localState.freshness === "current" &&
      localState.document.selectedConfig.path === configPath &&
      localState.document.selectedConfig.revision === config.revision,
    "UNTRUSTED_INPUT",
  );
  return {
    config,
    catalog: { ...catalog, document: catalog.document },
    localState: { ...localState, document: localState.document },
  };
}

export async function createPrimarySelectionPlan(
  input: PrimarySelectionRequest,
  createdAt = new Date().toISOString(),
  storeRegistry: StoreAdapterRegistry = createBuiltinStoreRegistry(),
): Promise<WorkspacePlan> {
  exactKeys(input, ["configPath", "repositoryId", "workspaceId"]);
  const request = structuredClone(input);
  requireThat(request.configPath === resolve(request.configPath), "INVALID_CONFIG");
  const loaded = await currentRegistryForLocalState(request.configPath, storeRegistry);
  requireThat(
    loaded.catalog.document.repositories.some((repository) => repository.id === request.repositoryId),
    "NOT_FOUND",
  );
  const workspace = loaded.localState.document.repositoryWorkspaces.find(
    (candidate) => candidate.id === request.workspaceId,
  );
  requireThat(
    workspace !== undefined && workspace.repositoryId === request.repositoryId && workspace.kind === "primary",
    "NOT_FOUND",
  );
  const next = structuredClone(loaded.localState.document);
  for (const candidate of next.repositoryWorkspaces) {
    if (candidate.repositoryId === request.repositoryId)
      candidate.primarySelected = candidate.id === request.workspaceId;
  }
  return localStateChangePlanCore({
    kind: "workspace-primary",
    configPath: request.configPath,
    plansDirectory: loaded.config.document.plans.directory,
    localStatePath: loaded.config.document.localState.path,
    configRevision: loaded.config.revision,
    catalogRevision: loaded.catalog.revision,
    localStateRevision: loaded.localState.revision,
    repositoryId: request.repositoryId,
    request: { repositoryId: request.repositoryId, workspaceId: request.workspaceId },
    nextLocalState: validateLocalStateDocument(next),
    createdAt,
  });
}

interface AdoptObservation {
  path: string;
  remote: string;
  head: string | null;
  branch: string | null;
  dirty: boolean;
  worktree: boolean;
  statusDigest: string;
}

async function observeAdoptTarget(
  path: string,
  trustedRoots: string[],
): Promise<AdoptObservation> {
  requireThat(path === resolve(path) && trustedRoots.some((root) => contained(root, path)), "INVALID_CONFIG");
  const inventory = await discoverLocal(path, { depth: 0, trustedMetadataRoots: trustedRoots });
  const observation = inventory.repositories.find((candidate) => candidate.path === path);
  requireThat(observation !== undefined && observation.remote !== null, "UNAVAILABLE");
  return {
    path,
    remote: observation.remote,
    head: observation.head,
    branch: observation.branch ?? null,
    dirty: observation.dirty,
    worktree: observation.worktree,
    statusDigest: digest(observation.status),
  };
}

export async function createAdoptPlan(
  input: AdoptRequest,
  createdAt = new Date().toISOString(),
  storeRegistry: StoreAdapterRegistry = createBuiltinStoreRegistry(),
): Promise<WorkspacePlan> {
  exactKeys(input, ["configPath", "repositoryId", "path"]);
  const request = structuredClone(input);
  requireThat(request.configPath === resolve(request.configPath), "INVALID_CONFIG");
  const loaded = await currentRegistryForLocalState(request.configPath, storeRegistry);
  const repository = loaded.catalog.document.repositories.find(
    (candidate) => candidate.id === request.repositoryId,
  );
  requireThat(repository !== undefined, "NOT_FOUND");
  requireThat(
    !loaded.localState.document.repositoryWorkspaces.some((workspace) => workspace.path === request.path),
    "CONFLICT",
  );
  const observation = await observeAdoptTarget(request.path, loaded.config.document.trustedRoots);
  requireThat(observation.remote === canonicalRemote(repository.remote), "CONFLICT");
  const workspaceId = `workspace-${digest({ repositoryId: request.repositoryId, path: request.path }).slice(0, 24)}`;
  requireThat(
    !loaded.localState.document.repositoryWorkspaces.some((workspace) => workspace.id === workspaceId),
    "CONFLICT",
  );
  const next = structuredClone(loaded.localState.document);
  next.repositoryWorkspaces.push({
    id: workspaceId,
    kind: observation.worktree ? "worktree" : "primary",
    repositoryId: request.repositoryId,
    path: request.path,
    branch: observation.branch,
    primarySelected: false,
    hostLinks: {},
  });
  return localStateChangePlanCore({
    kind: "adopt",
    configPath: request.configPath,
    plansDirectory: loaded.config.document.plans.directory,
    localStatePath: loaded.config.document.localState.path,
    configRevision: loaded.config.revision,
    catalogRevision: loaded.catalog.revision,
    localStateRevision: loaded.localState.revision,
    repositoryId: request.repositoryId,
    request: {
      repositoryId: request.repositoryId,
      path: request.path,
      workspaceId,
      observation: observation as unknown as Json,
    },
    nextLocalState: validateLocalStateDocument(next),
    createdAt,
  });
}

function descendantGroupIds(catalog: CatalogDocument, groupId: string): Set<string> {
  const ids = new Set([groupId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of catalog.groups) {
      if (group.parentId !== null && ids.has(group.parentId) && !ids.has(group.id)) {
        ids.add(group.id);
        changed = true;
      }
    }
  }
  return ids;
}

export async function createCoordinationWorkspacePlan(
  input: CoordinationCreateRequest,
  createdAt = new Date().toISOString(),
  storeRegistry: StoreAdapterRegistry = createBuiltinStoreRegistry(),
): Promise<WorkspacePlan> {
  exactKeys(input, ["configPath", "groupId", "path"]);
  requireThat(input.configPath === resolve(input.configPath) && input.path === resolve(input.path), "INVALID_CONFIG");
  const loaded = await currentRegistryForLocalState(input.configPath, storeRegistry);
  const group = loaded.catalog.document.groups.find((candidate) => candidate.id === input.groupId);
  requireThat(group !== undefined, "NOT_FOUND");
  requireThat(loaded.config.document.trustedRoots.some((root) => contained(root, input.path)), "INVALID_CONFIG");
  await requireStablePath(input.path, { allowMissing: true });
  await requireRealDirectory(dirname(input.path));
  await requireAbsent(input.path);
  requireThat(!loaded.localState.document.coordinationWorkspaces.some((workspace) => workspace.path === input.path || workspace.scope.id === input.groupId), "CONFLICT");
  requireThat(!loaded.localState.document.repositoryWorkspaces.some((workspace) => contained(workspace.path, input.path) || contained(input.path, workspace.path)), "CONFLICT");

  const descendants = descendantGroupIds(loaded.catalog.document, group.id);
  const repositories = loaded.catalog.document.repositories.filter((repository) =>
    (repository.primaryGroupId !== null && descendants.has(repository.primaryGroupId)) ||
    (group.kind === "project" && repository.memberOf.includes(group.id))
  ).sort((a, b) => a.id.localeCompare(b.id));
  requireThat(repositories.length > 0, "NOT_FOUND");
  const members: Array<{ repositoryId: string; workspaceId: string; path: string }> = [];
  for (const repository of repositories) {
    const selected = loaded.localState.document.repositoryWorkspaces.filter((workspace) => workspace.repositoryId === repository.id && workspace.primarySelected);
    requireThat(selected.length === 1, selected.length === 0 ? "NOT_FOUND" : "AMBIGUOUS");
    const inventory = await discoverLocal(selected[0].path, { depth: 0, trustedMetadataRoots: loaded.config.document.trustedRoots });
    const observed = inventory.repositories.find((candidate) => candidate.path === selected[0].path);
    requireThat(observed?.remote === canonicalRemote(repository.remote), "CONFLICT");
    members.push({ repositoryId: repository.id, workspaceId: selected[0].id, path: selected[0].path });
  }
  const workspaceId = `coordination-${digest({ groupId: group.id, path: input.path }).slice(0, 24)}`;
  requireThat(!loaded.localState.document.coordinationWorkspaces.some((workspace) => workspace.id === workspaceId), "CONFLICT");
  const files = [
    {
      name: "WORKSPACE.md",
      content: `# ${group.name}\n\nCoordination workspace: ${workspaceId}\n\nMembers are references only; source trees are not copied.\n`,
    },
    {
      name: "members.json",
      content: JSON.stringify({ schemaVersion: 1, workspaceId, scope: { kind: group.kind, id: group.id }, members }, null, 2) + "\n",
    },
  ].map((file) => ({ ...file, sha256: digest(file.content) }));
  const bindingBase = {
    id: workspaceId,
    kind: "coordination" as const,
    scope: { kind: group.kind, id: group.id },
    path: input.path,
    memberRepositoryIds: members.map((member) => member.repositoryId),
    memberWorkspaceIds: members.map((member) => member.workspaceId),
    hostProjectId: null,
    generatedFiles: files.map((file) => file.name),
  };
  const binding: CoordinationWorkspace = { ...bindingBase, revision: documentRevision(bindingBase) };
  const next = structuredClone(loaded.localState.document);
  next.coordinationWorkspaces.push(binding);
  const validated = validateLocalStateDocument(next);
  const nextRevision = documentRevision(validated);
  return finishPlan({
    schemaVersion: 2,
    format: "workspacectl-plan/1",
    kind: "coordination-create",
    createdAt,
    inputRevisions: { config: loaded.config.revision, catalog: loaded.catalog.revision, localState: loaded.localState.revision, sources: {} },
    repositoryIds: members.map((member) => member.repositoryId),
    request: {
      configPath: input.configPath,
      plansDirectory: loaded.config.document.plans.directory,
      groupId: group.id,
      path: input.path,
      workspaceId,
      files: files as unknown as Json,
      binding: binding as unknown as Json,
      localStateChange: { currentRevision: loaded.localState.revision, nextRevision },
    },
    actions: [
      { id: "create-coordination-directory", type: "directory-create", path: input.path },
      ...files.map((file) => ({ id: `create-${file.name}`, type: "file-create" as const, path: join(input.path, file.name), sha256: file.sha256 })),
      { id: "write-local-state", type: "document-cas", target: "local-state", path: loaded.config.document.localState.path, expectedRevision: loaded.localState.revision, nextRevision },
    ],
    preconditions: [
      { id: "config-current", type: "revision", target: "config", expected: loaded.config.revision },
      { id: "catalog-current", type: "revision", target: "catalog", expected: loaded.catalog.revision },
      { id: "local-state-current", type: "revision", target: "local-state", expected: loaded.localState.revision },
      { id: "destination-absent", type: "revision", target: "coordination-directory", expected: ABSENT_REVISION },
    ],
    expectedOutputs: [{ id: "local-state-edited", type: "document", target: "local-state", revision: nextRevision }],
    approvalsRequired: [{ id: "apply", kind: "explicit-plan-id" }],
  });
}

function importRequest(input: unknown): ImportRequest {
  exactKeys(input, ["configPath", "manifestPath", "unclassifiedPath"]);
  const request = structuredClone(input) as unknown as ImportRequest;
  for (const path of [
    request.configPath,
    request.manifestPath,
    request.unclassifiedPath,
  ]) requireThat(path === resolve(path), "INVALID_CONFIG");
  requireThat(
    new Set([
      request.configPath,
      request.manifestPath,
      request.unclassifiedPath,
    ]).size === 3,
    "INVALID_CONFIG",
  );
  return request;
}

export async function createImportPlan(
  input: ImportRequest,
  createdAt = new Date().toISOString(),
): Promise<WorkspacePlan> {
  const request = importRequest(input);
  const loadedConfig = await loadWorkspacesConfig(request.configPath);
  const config = loadedConfig.document;
  requireThat(
    ![
      request.manifestPath,
      request.unclassifiedPath,
    ].some((path) =>
      [request.configPath, config.catalog.path, config.localState.path].includes(path),
    ),
    "INVALID_CONFIG",
  );
  const catalogStore = new FileCatalogStore(config.catalog.path);
  const localStateStore = new FileLocalStateStore(config.localState.path);
  const [catalog, localState, manifest, unclassified] = await Promise.all([
    catalogStore.read(),
    localStateStore.read(),
    readImportSource(request.manifestPath),
    readImportSource(request.unclassifiedPath),
  ]);
  requireThat(
    catalog.document !== null &&
      catalog.freshness === "current" &&
      catalog.capabilities.read === true &&
      catalog.capabilities.compareAndSwap === "supported",
    "UNTRUSTED_INPUT",
  );
  requireThat(
    localState.document !== null &&
      localState.freshness === "current" &&
      localState.capabilities.read === true &&
      localState.document.selectedConfig.path === request.configPath &&
      localState.document.selectedConfig.revision === loadedConfig.revision,
    "UNTRUSTED_INPUT",
  );
  requireThat(
    canonicalJson(catalog.document) === canonicalJson(emptyCatalogDocument()),
    "CONFLICT",
  );
  const nextCatalog = convertV1Catalog(manifest.value, unclassified.value);
  const nextRevision = documentRevision(nextCatalog);
  const unclassifiedCount = nextCatalog.repositories.filter(
    (repository) => repository.classification === "unclassified",
  ).length;
  const counts: ImportCounts = {
    classified: nextCatalog.repositories.length - unclassifiedCount,
    unclassified: unclassifiedCount,
    total: nextCatalog.repositories.length,
  };
  const planRequest = {
    ...request,
    plansDirectory: config.plans.directory,
    counts,
  };
  return finishPlan({
    schemaVersion: 2,
    format: "workspacectl-plan/1",
    kind: "import-v1",
    createdAt,
    inputRevisions: {
      config: loadedConfig.revision,
      catalog: catalog.revision,
      localState: localState.revision,
      sources: {
        manifest: manifest.sha256,
        unclassified: unclassified.sha256,
      },
    },
    repositoryIds: nextCatalog.repositories.map((repository) => repository.id),
    request: planRequest as unknown as Record<string, Json>,
    actions: [
      {
        id: "write-imported-catalog",
        type: "document-cas",
        target: "catalog",
        path: config.catalog.path,
        expectedRevision: catalog.revision,
        nextRevision,
      },
    ],
    preconditions: [
      { id: "config-current", type: "revision", target: "config", expected: loadedConfig.revision },
      { id: "catalog-empty", type: "revision", target: "catalog", expected: catalog.revision },
      { id: "local-state-current", type: "revision", target: "local-state", expected: localState.revision },
      { id: "manifest-current", type: "source-digest", target: "manifest", expected: manifest.sha256 },
      { id: "unclassified-current", type: "source-digest", target: "unclassified", expected: unclassified.sha256 },
    ],
    expectedOutputs: [
      { id: "catalog-imported", type: "document", target: "catalog", revision: nextRevision },
    ],
    approvalsRequired: [{ id: "apply", kind: "explicit-plan-id" }],
  });
}

export async function saveWorkspacePlan(
  path: string,
  input: WorkspacePlan,
): Promise<void> {
  const plan = validateWorkspacePlan(input);
  assertWorkspacePlanIntegrity(plan);
  requireThat(path === resolve(path), "INVALID_CONFIG");
  const plansDirectory = plan.request.plansDirectory;
  requireThat(
    typeof plansDirectory === "string" && dirname(path) === plansDirectory,
    "INVALID_CONFIG",
  );
  await requireRealDirectory(plansDirectory);
  await requireStablePath(path, { allowMissing: true });
  let handle;
  let created = false;
  let saved = false;
  try {
    handle = await open(path, "wx", 0o600);
    created = true;
    await handle.writeFile(JSON.stringify(plan, null, 2) + "\n", "utf8");
    await handle.sync();
    if (plan.kind === "worktree-create" || plan.kind === "worktree-remove")
      await saveWorktreePlanAuthority(plan);
    saved = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST")
      throw new GovernanceError("CONFLICT");
    if (error instanceof GovernanceError) throw error;
    throw new GovernanceError("ACTION_FAILED");
  } finally {
    await handle?.close();
    if (created && !saved) {
      try {
        await unlink(path);
      } catch {
        // Only the exclusive candidate owned by this call is eligible here.
      }
    }
  }
}

export async function loadWorkspacePlan(path: string): Promise<WorkspacePlan> {
  let handle;
  try {
    await requireStablePath(path);
    const status = await lstat(path);
    requireThat(
      status.isFile() && !status.isSymbolicLink() && status.size <= MAX_DOCUMENT_BYTES,
      "INVALID_CONFIG",
    );
    handle = await open(path, "r");
    const bytes = Buffer.alloc(MAX_DOCUMENT_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    requireThat(length <= MAX_DOCUMENT_BYTES, "INVALID_CONFIG");
    const text = new TextDecoder("utf8", { fatal: true }).decode(bytes.subarray(0, length));
    const plan = validateWorkspacePlan(
      parseDataText(text, "json", MAX_DOCUMENT_BYTES),
    );
    assertWorkspacePlanIntegrity(plan);
    return plan;
  } catch (error) {
    if (error instanceof GovernanceError) throw error;
    throw new GovernanceError("INVALID_CONFIG");
  } finally {
    await handle?.close();
  }
}

export async function loadWorkspacesConfig(
  path: string,
): Promise<{ document: WorkspacesConfig; revision: string }> {
  const read = await new FileConfigStore(path).read();
  requireThat(read.document !== null, "NOT_CONFIGURED");
  requireThat(
    read.freshness === "current" &&
      read.capabilities.read === true,
    "UNTRUSTED_INPUT",
  );
  return { document: read.document, revision: read.revision };
}

async function requireLocksAbsent(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await requireStablePath(path, { allowMissing: true });
      await lstat(`${path}.lock`);
      throw new GovernanceError("BUSY");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue;
      if (error instanceof GovernanceError) throw error;
      throw new GovernanceError("ACTION_FAILED");
    }
  }
}

function initDocuments(request: InitRequest) {
  const config = configFor(request);
  const catalog = emptyCatalogDocument();
  const localState = emptyLocalStateDocument(
    request.configPath,
    documentRevision(config),
  );
  return { config, catalog, localState };
}

function savedImportRequest(
  input: unknown,
): ImportRequest & { plansDirectory: string; counts: ImportCounts } {
  exactKeys(input, [
    "configPath",
    "manifestPath",
    "unclassifiedPath",
    "plansDirectory",
    "counts",
  ]);
  const request = importRequest({
    configPath: input.configPath,
    manifestPath: input.manifestPath,
    unclassifiedPath: input.unclassifiedPath,
  });
  requireThat(
    typeof input.plansDirectory === "string" &&
      input.plansDirectory === resolve(input.plansDirectory),
    "INVALID_CONFIG",
  );
  exactKeys(input.counts, ["classified", "unclassified", "total"]);
  const counts = structuredClone(input.counts) as unknown as ImportCounts;
  requireThat(
    [counts.classified, counts.unclassified, counts.total].every(
      (count) => Number.isSafeInteger(count) && count >= 0 && count <= 10_000,
    ) && counts.classified + counts.unclassified === counts.total,
    "INVALID_CONFIG",
  );
  return { ...request, plansDirectory: input.plansDirectory, counts };
}

async function applyImportPlan(
  plan: WorkspacePlan,
  options: ApplyOptions,
): Promise<AppliedRegistryPlan> {
  const saved = savedImportRequest(plan.request);
  requireThat(options.selectedConfigPath === saved.configPath, "STALE_PLAN");
  let derived: WorkspacePlan;
  try {
    derived = await createImportPlan(
      {
        configPath: saved.configPath,
        manifestPath: saved.manifestPath,
        unclassifiedPath: saved.unclassifiedPath,
      },
      plan.createdAt,
    );
  } catch (error) {
    if (error instanceof GovernanceError)
      throw new GovernanceError("STALE_PLAN");
    throw error;
  }
  requireThat(
    canonicalJson(workspacePlanSemanticFields(derived)) ===
      canonicalJson(workspacePlanSemanticFields(plan)),
    "STALE_PLAN",
  );

  const loadedConfig = await loadWorkspacesConfig(saved.configPath);
  requireThat(
    loadedConfig.revision === plan.inputRevisions.config &&
      loadedConfig.document.plans.directory === saved.plansDirectory,
    "STALE_PLAN",
  );
  const catalogStore = new FileCatalogStore(loadedConfig.document.catalog.path);
  const localStateStore = new FileLocalStateStore(loadedConfig.document.localState.path);
  const [catalogBefore, localState, manifest, unclassified] = await Promise.all([
    catalogStore.read(),
    localStateStore.read(),
    readImportSource(saved.manifestPath),
    readImportSource(saved.unclassifiedPath),
  ]);
  requireThat(
    catalogBefore.document !== null &&
      catalogBefore.revision === plan.inputRevisions.catalog &&
      localState.document !== null &&
      localState.revision === plan.inputRevisions.localState &&
      manifest.sha256 === plan.inputRevisions.sources.manifest &&
      unclassified.sha256 === plan.inputRevisions.sources.unclassified,
    "STALE_PLAN",
  );
  const nextCatalog = convertV1Catalog(manifest.value, unclassified.value);
  requireThat(
    documentRevision(nextCatalog) ===
      plan.expectedOutputs.find((output) => output.target === "catalog")?.revision,
    "STALE_PLAN",
  );
  await requireLocksAbsent([loadedConfig.document.catalog.path]);
  const catalog = await writeCatalogDocument(
    catalogStore,
    plan.inputRevisions.catalog,
    nextCatalog,
  );
  requireThat(catalog.document !== null, "ACTION_FAILED");
  return {
    planId: plan.id,
    kind: "import-v1",
    revisions: {
      config: loadedConfig.revision,
      catalog: catalog.revision,
      localState: localState.revision,
    },
    readback: {
      config: loadedConfig.document,
      catalog: catalog.document,
      localState: localState.document,
    },
  };
}

async function applyCatalogChangePlan(
  plan: WorkspacePlan,
  options: ApplyOptions,
): Promise<AppliedRegistryPlan> {
  const request = plan.request;
  const draftBacked = Object.hasOwn(request, "draftPath");
  exactKeys(
    request,
    draftBacked
      ? ["configPath", "draftPath", "plansDirectory", "catalogChange"]
      : ["configPath", "plansDirectory", "operation", "catalogChange"],
  );
  const configPath = request.configPath;
  requireThat(typeof configPath === "string", "INVALID_CONFIG");
  requireThat(options.selectedConfigPath === configPath, "STALE_PLAN");
  const savedOperation = draftBacked
    ? undefined
    : catalogEditOperation(request.operation);
  let derived: WorkspacePlan;
  try {
    derived = draftBacked
      ? await createCatalogChangePlan(
          { configPath, draftPath: request.draftPath as string },
          plan.createdAt,
          options.storeRegistry,
        )
      : await createCatalogOperationPlan(
          configPath,
          savedOperation as CatalogEditOperation,
          plan.createdAt,
          options.storeRegistry,
        );
  } catch (error) {
    if (
      error instanceof GovernanceError &&
      ["CONFLICT", "UNSUPPORTED", "UNTRUSTED_INPUT"].includes(error.code)
    ) throw error;
    if (error instanceof GovernanceError) throw new GovernanceError("STALE_PLAN");
    throw error;
  }
  requireThat(
    derived.inputRevisions.catalog === plan.inputRevisions.catalog,
    "CONFLICT",
  );
  requireThat(
    canonicalJson(workspacePlanSemanticFields(derived)) ===
      canonicalJson(workspacePlanSemanticFields(plan)),
    "STALE_PLAN",
  );

  await options.testHooks?.beforeCatalogFinalSnapshot?.();
  const action = plan.actions.find((candidate) => candidate.target === "catalog");
  const expectedOutput = plan.expectedOutputs.find((candidate) => candidate.target === "catalog");
  requireThat(action !== undefined && expectedOutput !== undefined, "STALE_PLAN");
  const loadedConfig = await loadWorkspacesConfig(configPath);
  requireThat(
    loadedConfig.revision === plan.inputRevisions.config &&
      loadedConfig.document.catalog.path === action.path &&
      loadedConfig.document.plans.directory === request.plansDirectory,
    "STALE_PLAN",
  );
  const storeRegistry = options.storeRegistry ?? createBuiltinStoreRegistry();
  const catalogStore = storeRegistry.createCatalog(
    loadedConfig.document.catalog.adapter,
    action.path,
  );
  const localStateStore = storeRegistry.createLocalState(
    loadedConfig.document.localState.adapter,
    loadedConfig.document.localState.path,
  );
  const [currentCatalog, localState, finalDraft] = await Promise.all([
    catalogStore.read(),
    localStateStore.read(),
    draftBacked ? readCatalogDraft(request.draftPath as string) : Promise.resolve(undefined),
  ]);
  requireThat(
    currentCatalog.document !== null &&
      currentCatalog.revision === plan.inputRevisions.catalog &&
      localState.document !== null &&
      localState.revision === plan.inputRevisions.localState &&
      localState.document.selectedConfig.path === configPath &&
      localState.document.selectedConfig.revision === loadedConfig.revision &&
      action.expectedRevision === plan.inputRevisions.catalog,
    "STALE_PLAN",
  );
  if (draftBacked) {
    requireThat(
      finalDraft?.sha256 === plan.inputRevisions.sources.draft &&
        finalDraft.draft.expectedRevision === plan.inputRevisions.catalog,
      "STALE_PLAN",
    );
  }
  const nextCatalog = draftBacked
    ? finalDraft!.draft.document
    : applyCatalogOperation(
        currentCatalog.document,
        savedOperation as CatalogEditOperation,
      );
  const approvedNextRevision = (request.catalogChange as Record<string, Json>).nextRevision;
  requireThat(
    documentRevision(nextCatalog) === action.nextRevision &&
      action.nextRevision === expectedOutput.revision &&
      action.nextRevision === approvedNextRevision,
    "STALE_PLAN",
  );
  if (loadedConfig.document.catalog.adapter === "file")
    await requireLocksAbsent([action.path]);
  await writeCatalogDocument(catalogStore, plan.inputRevisions.catalog, nextCatalog);
  await options.testHooks?.afterCatalogWriteBeforeReadback?.();

  const [configReadback, catalogReadback, localStateReadback] = await Promise.all([
    loadWorkspacesConfig(configPath),
    catalogStore.read(),
    localStateStore.read(),
  ]);
  requireThat(
    catalogReadback.document !== null &&
      catalogReadback.revision === expectedOutput.revision &&
      documentRevision(catalogReadback.document) === expectedOutput.revision &&
      canonicalJson(catalogReadback.document) === canonicalJson(nextCatalog) &&
      localStateReadback.document !== null,
    "ACTION_FAILED",
  );
  return {
    planId: plan.id,
    kind: "catalog-edit",
    revisions: {
      config: configReadback.revision,
      catalog: catalogReadback.revision,
      localState: localStateReadback.revision,
    },
    readback: {
      config: configReadback.document,
      catalog: catalogReadback.document,
      localState: localStateReadback.document,
    },
    ...(!draftBacked && savedOperation?.type === "repo-classify"
      ? {
          transition: {
            type: "classification" as const,
            repositoryId: savedOperation.id,
            decision: savedOperation.decision === "accept"
              ? "accepted" as const
              : "rejected" as const,
            primaryGroupId: savedOperation.decision === "accept"
              ? savedOperation.groupId!
              : null,
          },
        }
      : {}),
  };
}

async function applyWorkspaceChangePlan(plan: WorkspacePlan, options: ApplyOptions): Promise<AppliedRegistryPlan> {
  exactKeys(plan.request, ["configPath", "draftPath", "plansDirectory", "workspaceId", "localStateChange"]);
  requireThat(typeof plan.request.configPath === "string" && typeof plan.request.draftPath === "string" && options.selectedConfigPath === plan.request.configPath, "STALE_PLAN");
  const storeRegistry = options.storeRegistry ?? createBuiltinStoreRegistry();
  let derived: WorkspacePlan;
  try {
    derived = await createWorkspaceChangePlan(
      { configPath: plan.request.configPath, draftPath: plan.request.draftPath },
      plan.createdAt,
      storeRegistry,
    );
  } catch (error) {
    if (
      error instanceof GovernanceError &&
      ["CONFLICT", "UNSUPPORTED", "UNTRUSTED_INPUT"].includes(error.code)
    ) throw error;
    if (error instanceof GovernanceError) throw new GovernanceError("STALE_PLAN");
    throw error;
  }
  requireThat(
    derived.inputRevisions.localState === plan.inputRevisions.localState,
    "CONFLICT",
  );
  requireThat(canonicalJson(workspacePlanSemanticFields(derived)) === canonicalJson(workspacePlanSemanticFields(plan)), "STALE_PLAN");
  const loaded = await currentRegistryForLocalState(plan.request.configPath, storeRegistry);
  const source = await readLocalStateDraft(plan.request.draftPath);
  const action = plan.actions.find((candidate) => candidate.target === "local-state");
  const output = plan.expectedOutputs.find((candidate) => candidate.target === "local-state");
  requireThat(
    action !== undefined && output !== undefined &&
      loaded.config.revision === plan.inputRevisions.config &&
      loaded.catalog.revision === plan.inputRevisions.catalog &&
      loaded.localState.revision === plan.inputRevisions.localState &&
      loaded.config.document.localState.path === action.path &&
      action.expectedRevision === plan.inputRevisions.localState &&
      source.sha256 === plan.inputRevisions.sources.draft &&
      source.draft.expectedRevision === loaded.localState.revision,
    "STALE_PLAN",
  );
  const next = validateLocalStateDocument(source.draft.document);
  requireThat(documentRevision(next) === action.nextRevision && action.nextRevision === output.revision, "STALE_PLAN");
  const catalogStore = storeRegistry.createCatalog(
    loaded.config.document.catalog.adapter,
    loaded.config.document.catalog.path,
  );
  const localStateStore = storeRegistry.createLocalState(
    loaded.config.document.localState.adapter,
    action.path,
  );
  if (loaded.config.document.localState.adapter === "file")
    await requireLocksAbsent([action.path]);
  await writeLocalStateDocument(localStateStore, plan.inputRevisions.localState, next);
  const [configReadback, catalogReadback, localStateReadback] = await Promise.all([
    loadWorkspacesConfig(plan.request.configPath),
    catalogStore.read(),
    localStateStore.read(),
  ]);
  requireThat(
    catalogReadback.document !== null &&
      catalogReadback.capabilities.read === true &&
      catalogReadback.freshness === "current" &&
      catalogReadback.revision === plan.inputRevisions.catalog &&
      localStateReadback.document !== null &&
      localStateReadback.capabilities.read === true &&
      localStateReadback.capabilities.compareAndSwap === "supported" &&
      localStateReadback.freshness === "current" &&
      localStateReadback.revision === output.revision &&
      documentRevision(localStateReadback.document) === output.revision &&
      canonicalJson(localStateReadback.document) === canonicalJson(next),
    "ACTION_FAILED",
  );
  return {
    planId: plan.id,
    kind: "workspace-edit",
    revisions: {
      config: configReadback.revision,
      catalog: catalogReadback.revision,
      localState: localStateReadback.revision,
    },
    readback: {
      config: configReadback.document,
      catalog: catalogReadback.document,
      localState: localStateReadback.document,
    },
  };
}

async function applyCoordinationCreatePlan(plan: WorkspacePlan, options: ApplyOptions): Promise<AppliedRegistryPlan> {
  exactKeys(plan.request, ["configPath", "plansDirectory", "groupId", "path", "workspaceId", "files", "binding", "localStateChange"]);
  requireThat(typeof plan.request.configPath === "string" && typeof plan.request.groupId === "string" && typeof plan.request.path === "string" && options.selectedConfigPath === plan.request.configPath, "STALE_PLAN");
  const targetPath = plan.request.path;
  const storeRegistry = options.storeRegistry ?? createBuiltinStoreRegistry();
  let derived: WorkspacePlan;
  try {
    derived = await createCoordinationWorkspacePlan(
      { configPath: plan.request.configPath, groupId: plan.request.groupId, path: plan.request.path },
      plan.createdAt,
      storeRegistry,
    );
  } catch (error) {
    if (
      error instanceof GovernanceError &&
      ["CONFLICT", "UNSUPPORTED", "UNTRUSTED_INPUT"].includes(error.code)
    ) throw error;
    if (error instanceof GovernanceError) throw new GovernanceError("STALE_PLAN");
    throw error;
  }
  requireThat(canonicalJson(workspacePlanSemanticFields(derived)) === canonicalJson(workspacePlanSemanticFields(plan)), "STALE_PLAN");
  const loaded = await currentRegistryForLocalState(plan.request.configPath, storeRegistry);
  const action = plan.actions.find((candidate) => candidate.type === "document-cas" && candidate.target === "local-state");
  const output = plan.expectedOutputs.find((candidate) => candidate.target === "local-state");
  requireThat(action !== undefined && output !== undefined && loaded.config.revision === plan.inputRevisions.config && loaded.catalog.revision === plan.inputRevisions.catalog && loaded.localState.revision === plan.inputRevisions.localState && loaded.config.document.localState.path === action.path, "STALE_PLAN");
  await requireAbsent(plan.request.path);
  await requireStablePath(plan.request.path, { allowMissing: true });
  const files = plan.request.files as unknown as Array<{ name: string; content: string; sha256: string }>;
  const next = structuredClone(loaded.localState.document);
  next.coordinationWorkspaces.push(plan.request.binding as unknown as CoordinationWorkspace);
  const validated = validateLocalStateDocument(next);
  requireThat(documentRevision(validated) === action.nextRevision && action.nextRevision === output.revision, "STALE_PLAN");
  const catalogStore = storeRegistry.createCatalog(
    loaded.config.document.catalog.adapter,
    loaded.config.document.catalog.path,
  );
  const localStateStore = storeRegistry.createLocalState(
    loaded.config.document.localState.adapter,
    action.path,
  );
  if (loaded.config.document.localState.adapter === "file")
    await requireLocksAbsent([action.path]);
  const parentPath = dirname(targetPath);
  const directoryName = basename(targetPath);
  const fdRoot = process.platform === "linux" ? "/proc/self/fd" : null;
  requireThat(fdRoot !== null, "UNSUPPORTED");
  const parentHandle = await open(parentPath, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  const parentIdentity = await parentHandle.stat();
  const parentAnchor = join(fdRoot, String(parentHandle.fd));
  let directoryHandle: Awaited<ReturnType<typeof open>> | undefined;
  let directoryIdentity: Awaited<ReturnType<typeof parentHandle.stat>> | undefined;
  const fileIdentities = new Map<string, { dev: number | bigint; ino: number | bigint }>();
  let casApplied = false;
  const sameIdentity = (left: { dev: number | bigint; ino: number | bigint }, right: { dev: number | bigint; ino: number | bigint }) => left.dev === right.dev && left.ino === right.ino;
  const visibleIdentityExact = async () => {
    const visibleParent = await lstat(parentPath);
    const visibleDirectory = await lstat(targetPath);
    requireThat(!visibleParent.isSymbolicLink() && visibleParent.isDirectory() && sameIdentity(visibleParent, parentIdentity), "ACTION_FAILED");
    requireThat(directoryIdentity !== undefined && !visibleDirectory.isSymbolicLink() && visibleDirectory.isDirectory() && sameIdentity(visibleDirectory, directoryIdentity), "ACTION_FAILED");
  };
  const verifyFiles = async () => {
    await visibleIdentityExact();
    const directoryAnchor = join(fdRoot, String(directoryHandle!.fd));
    for (const file of files) {
      const status = await lstat(join(directoryAnchor, file.name));
      const expected = fileIdentities.get(file.name);
      requireThat(expected !== undefined && status.isFile() && !status.isSymbolicLink() && sameIdentity(status, expected), "ACTION_FAILED");
      const handle = await open(join(directoryAnchor, file.name), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      try { requireThat(digest(await handle.readFile("utf8")) === file.sha256, "ACTION_FAILED"); } finally { await handle.close(); }
    }
  };
  const restoreFiles = async () => {
    await visibleIdentityExact();
    const directoryAnchor = join(fdRoot, String(directoryHandle!.fd));
    for (const file of files) {
      const artifactPath = join(directoryAnchor, file.name);
      const expected = fileIdentities.get(file.name);
      requireThat(expected !== undefined, "ACTION_FAILED");
      let handle: Awaited<ReturnType<typeof open>>;
      try {
        handle = await open(artifactPath, fsConstants.O_RDWR | fsConstants.O_NOFOLLOW);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
        handle = await open(artifactPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW, 0o600);
        const status = await handle.stat();
        requireThat(status.isFile(), "ACTION_FAILED");
        fileIdentities.set(file.name, { dev: status.dev, ino: status.ino });
      }
      try {
        const status = await handle.stat();
        const currentExpected = fileIdentities.get(file.name);
        requireThat(status.isFile() && currentExpected !== undefined && sameIdentity(status, currentExpected), "ACTION_FAILED");
        await handle.truncate(0);
        await handle.writeFile(file.content);
        await handle.sync();
      } finally { await handle.close(); }
    }
    await verifyFiles();
  };
  const cleanupExactArtifacts = async () => {
    if (directoryHandle === undefined || directoryIdentity === undefined) return;
    const directoryAnchor = join(fdRoot, String(directoryHandle.fd));
    for (const file of [...files].reverse()) {
      const expected = fileIdentities.get(file.name);
      if (expected === undefined) continue;
      try {
        const status = await lstat(join(directoryAnchor, file.name));
        if (status.isFile() && !status.isSymbolicLink() && sameIdentity(status, expected)) await unlink(join(directoryAnchor, file.name));
      } catch { /* exact artifact already absent */ }
    }
    try {
      const status = await lstat(join(parentAnchor, directoryName));
      if (status.isDirectory() && !status.isSymbolicLink() && sameIdentity(status, directoryIdentity)) await rmdir(join(parentAnchor, directoryName));
    } catch { /* never remove a non-matching replacement */ }
  };
  try {
    await options.testHooks?.beforeCoordinationDirectoryCreate?.();
    await mkdir(join(parentAnchor, directoryName), { mode: 0o700 });
    directoryHandle = await open(join(parentAnchor, directoryName), fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
    directoryIdentity = await directoryHandle.stat();
    const directoryAnchor = join(fdRoot, String(directoryHandle.fd));
    for (const file of files) {
      await visibleIdentityExact();
      const expectedPath = join(targetPath, file.name);
      const fileAction = plan.actions.find((candidate) => candidate.type === "file-create" && candidate.path === expectedPath);
      requireThat(fileAction?.sha256 === file.sha256 && digest(file.content) === file.sha256, "STALE_PLAN");
      const handle = await open(join(directoryAnchor, file.name), fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW, 0o600);
      try {
        await handle.writeFile(file.content);
        const status = await handle.stat();
        requireThat(status.isFile(), "ACTION_FAILED");
        fileIdentities.set(file.name, { dev: status.dev, ino: status.ino });
      } finally { await handle.close(); }
    }
    await verifyFiles();
    await writeLocalStateDocument(localStateStore, plan.inputRevisions.localState, validated);
    casApplied = true;
    await options.testHooks?.afterCoordinationLocalStateWriteBeforeReadback?.();
    const [configReadback, catalogReadback, localStateReadback] = await Promise.all([
      loadWorkspacesConfig(plan.request.configPath),
      catalogStore.read(),
      localStateStore.read(),
    ]);
    await verifyFiles();
    requireThat(
      catalogReadback.document !== null &&
        catalogReadback.freshness === "current" &&
        catalogReadback.revision === plan.inputRevisions.catalog &&
        localStateReadback.document !== null &&
        localStateReadback.freshness === "current" &&
        localStateReadback.revision === output.revision &&
        documentRevision(localStateReadback.document) === output.revision &&
        canonicalJson(localStateReadback.document) === canonicalJson(validated),
      "ACTION_FAILED",
    );
    return { planId: plan.id, kind: "coordination-create", revisions: { config: configReadback.revision, catalog: catalogReadback.revision, localState: localStateReadback.revision }, readback: { config: configReadback.document, catalog: catalogReadback.document, localState: localStateReadback.document } };
  } catch (error) {
    if (casApplied) {
      try {
        const state = await localStateStore.read();
        const exactBinding = state.document?.coordinationWorkspaces.some((candidate) => canonicalJson(candidate) === canonicalJson(plan.request.binding));
        if (exactBinding) {
          let restored = false;
          try {
            await restoreFiles();
            restored = true;
          } catch { /* fall back to exact-binding rollback */ }
          if (restored) throw new GovernanceError("ACTION_FAILED");
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const current = await localStateStore.read();
            if (current.document === null) break;
            const matching = current.document.coordinationWorkspaces.filter((candidate) => canonicalJson(candidate) === canonicalJson(plan.request.binding));
            if (matching.length === 0) {
              await cleanupExactArtifacts();
              throw new GovernanceError("ACTION_FAILED");
            }
            const rolledBack = structuredClone(current.document);
            rolledBack.coordinationWorkspaces = rolledBack.coordinationWorkspaces.filter((candidate) => canonicalJson(candidate) !== canonicalJson(plan.request.binding));
            try {
              await writeLocalStateDocument(localStateStore, current.revision, validateLocalStateDocument(rolledBack));
              await cleanupExactArtifacts();
              throw new GovernanceError("ACTION_FAILED");
            } catch (rollbackError) {
              const code = (rollbackError as { code?: unknown }).code;
              if (code !== "CONFLICT" && code !== "BUSY") throw rollbackError;
            }
          }
          throw new GovernanceError("ACTION_FAILED");
        }
        if (state.document !== null) await cleanupExactArtifacts();
      } catch (reconciliationError) {
        if (reconciliationError instanceof GovernanceError) throw reconciliationError;
        throw new GovernanceError("ACTION_FAILED");
      }
    } else await cleanupExactArtifacts();
    if (error instanceof GovernanceError) throw error;
    throw new GovernanceError("ACTION_FAILED");
  } finally {
    await directoryHandle?.close();
    await parentHandle.close();
  }
}

async function applyAdoptPlan(
  plan: WorkspacePlan,
  options: ApplyOptions,
): Promise<AppliedRegistryPlan> {
  exactKeys(plan.request, [
    "configPath", "plansDirectory", "repositoryId", "path", "workspaceId", "observation",
    "localStateChange",
  ]);
  requireThat(
    typeof plan.request.configPath === "string" &&
      typeof plan.request.repositoryId === "string" &&
      typeof plan.request.path === "string" &&
      typeof plan.request.workspaceId === "string" &&
      options.selectedConfigPath === plan.request.configPath,
    "STALE_PLAN",
  );
  const storeRegistry = options.storeRegistry ?? createBuiltinStoreRegistry();
  let derived: WorkspacePlan;
  try {
    derived = await createAdoptPlan({
      configPath: plan.request.configPath,
      repositoryId: plan.request.repositoryId,
      path: plan.request.path,
    }, plan.createdAt, storeRegistry);
  } catch (error) {
    if (
      error instanceof GovernanceError &&
      ["CONFLICT", "UNSUPPORTED", "UNTRUSTED_INPUT"].includes(error.code)
    ) throw error;
    if (error instanceof GovernanceError) throw new GovernanceError("STALE_PLAN");
    throw error;
  }
  requireThat(
    canonicalJson(workspacePlanSemanticFields(derived)) ===
      canonicalJson(workspacePlanSemanticFields(plan)),
    "STALE_PLAN",
  );
  const loaded = await currentRegistryForLocalState(plan.request.configPath, storeRegistry);
  const action = plan.actions.find((candidate) => candidate.target === "local-state");
  const output = plan.expectedOutputs.find((candidate) => candidate.target === "local-state");
  requireThat(
    action !== undefined && output !== undefined &&
      loaded.config.revision === plan.inputRevisions.config &&
      loaded.catalog.revision === plan.inputRevisions.catalog &&
      loaded.localState.revision === plan.inputRevisions.localState &&
      loaded.config.document.localState.path === action.path,
    "STALE_PLAN",
  );
  const observation = plan.request.observation as unknown as AdoptObservation;
  const next = structuredClone(loaded.localState.document);
  next.repositoryWorkspaces.push({
    id: plan.request.workspaceId,
    kind: observation.worktree ? "worktree" : "primary",
    repositoryId: plan.request.repositoryId,
    path: plan.request.path,
    branch: observation.branch,
    primarySelected: false,
    hostLinks: {},
  });
  const validated = validateLocalStateDocument(next);
  requireThat(
    documentRevision(validated) === action.nextRevision &&
      action.nextRevision === output.revision,
    "STALE_PLAN",
  );
  const catalogStore = storeRegistry.createCatalog(
    loaded.config.document.catalog.adapter,
    loaded.config.document.catalog.path,
  );
  const localStateStore = storeRegistry.createLocalState(
    loaded.config.document.localState.adapter,
    action.path,
  );
  if (loaded.config.document.localState.adapter === "file")
    await requireLocksAbsent([action.path]);
  await writeLocalStateDocument(
    localStateStore,
    plan.inputRevisions.localState,
    validated,
  );
  const [configReadback, catalogReadback, localStateReadback] = await Promise.all([
    loadWorkspacesConfig(plan.request.configPath),
    catalogStore.read(),
    localStateStore.read(),
  ]);
  requireThat(
    catalogReadback.document !== null &&
      catalogReadback.freshness === "current" &&
      catalogReadback.revision === plan.inputRevisions.catalog &&
      localStateReadback.document !== null &&
      localStateReadback.freshness === "current" &&
      localStateReadback.revision === output.revision &&
      documentRevision(localStateReadback.document) === output.revision &&
      canonicalJson(localStateReadback.document) === canonicalJson(validated),
    "ACTION_FAILED",
  );
  return {
    planId: plan.id,
    kind: "adopt",
    revisions: {
      config: configReadback.revision,
      catalog: catalogReadback.revision,
      localState: localStateReadback.revision,
    },
    readback: {
      config: configReadback.document,
      catalog: catalogReadback.document,
      localState: localStateReadback.document,
    },
  };
}

async function applyPrimarySelectionPlan(
  plan: WorkspacePlan,
  options: ApplyOptions,
): Promise<AppliedRegistryPlan> {
  exactKeys(plan.request, [
    "configPath", "plansDirectory", "repositoryId", "workspaceId", "localStateChange",
  ]);
  requireThat(
    typeof plan.request.configPath === "string" &&
      typeof plan.request.repositoryId === "string" &&
      typeof plan.request.workspaceId === "string" &&
      options.selectedConfigPath === plan.request.configPath,
    "STALE_PLAN",
  );
  const storeRegistry = options.storeRegistry ?? createBuiltinStoreRegistry();
  let derived: WorkspacePlan;
  try {
    derived = await createPrimarySelectionPlan({
      configPath: plan.request.configPath,
      repositoryId: plan.request.repositoryId,
      workspaceId: plan.request.workspaceId,
    }, plan.createdAt, storeRegistry);
  } catch (error) {
    if (
      error instanceof GovernanceError &&
      ["CONFLICT", "UNSUPPORTED", "UNTRUSTED_INPUT"].includes(error.code)
    ) throw error;
    if (error instanceof GovernanceError) throw new GovernanceError("STALE_PLAN");
    throw error;
  }
  requireThat(
    canonicalJson(workspacePlanSemanticFields(derived)) ===
      canonicalJson(workspacePlanSemanticFields(plan)),
    "STALE_PLAN",
  );
  const loaded = await currentRegistryForLocalState(plan.request.configPath, storeRegistry);
  const action = plan.actions.find((candidate) => candidate.target === "local-state");
  const output = plan.expectedOutputs.find((candidate) => candidate.target === "local-state");
  requireThat(
    action !== undefined && output !== undefined &&
      loaded.config.revision === plan.inputRevisions.config &&
      loaded.catalog.revision === plan.inputRevisions.catalog &&
      loaded.localState.revision === plan.inputRevisions.localState &&
      loaded.config.document.localState.path === action.path &&
      action.expectedRevision === plan.inputRevisions.localState,
    "STALE_PLAN",
  );
  const next = structuredClone(loaded.localState.document);
  for (const workspace of next.repositoryWorkspaces) {
    if (workspace.repositoryId === plan.request.repositoryId)
      workspace.primarySelected = workspace.id === plan.request.workspaceId;
  }
  const validated = validateLocalStateDocument(next);
  requireThat(
    documentRevision(validated) === action.nextRevision &&
      action.nextRevision === output.revision,
    "STALE_PLAN",
  );
  const catalogStore = storeRegistry.createCatalog(
    loaded.config.document.catalog.adapter,
    loaded.config.document.catalog.path,
  );
  const localStateStore = storeRegistry.createLocalState(
    loaded.config.document.localState.adapter,
    action.path,
  );
  if (loaded.config.document.localState.adapter === "file")
    await requireLocksAbsent([action.path]);
  await writeLocalStateDocument(
    localStateStore,
    plan.inputRevisions.localState,
    validated,
  );
  const [configReadback, catalogReadback, localStateReadback] = await Promise.all([
    loadWorkspacesConfig(plan.request.configPath),
    catalogStore.read(),
    localStateStore.read(),
  ]);
  requireThat(
    catalogReadback.document !== null &&
      catalogReadback.freshness === "current" &&
      catalogReadback.revision === plan.inputRevisions.catalog &&
      localStateReadback.document !== null &&
      localStateReadback.freshness === "current" &&
      localStateReadback.revision === output.revision &&
      documentRevision(localStateReadback.document) === output.revision &&
      canonicalJson(localStateReadback.document) === canonicalJson(validated),
    "ACTION_FAILED",
  );
  return {
    planId: plan.id,
    kind: "workspace-primary",
    revisions: {
      config: configReadback.revision,
      catalog: catalogReadback.revision,
      localState: localStateReadback.revision,
    },
    readback: {
      config: configReadback.document,
      catalog: catalogReadback.document,
      localState: localStateReadback.document,
    },
  };
}

export async function applyWorkspacePlan(
  input: WorkspacePlan,
  options: ApplyOptions,
): Promise<AppliedRegistryPlan> {
  const plan = validateWorkspacePlan(input);
  assertWorkspacePlanIntegrity(plan);
  requireThat(options.approval === plan.id, "APPROVAL_REQUIRED");
  requireThat(options.selectedConfigPath === resolve(options.selectedConfigPath), "INVALID_CONFIG");
  if (plan.kind === "checkout") return applyCheckoutPlan(plan, options.selectedConfigPath);
  if (plan.kind === "checkout-reconcile") return applyCheckoutReconcilePlan(plan, options.selectedConfigPath);
  if (plan.kind === "checkout-move") return applyMovePlan(plan, options.selectedConfigPath);
  if (plan.kind === "checkout-move-reconcile") return applyMoveReconcilePlan(plan, options.selectedConfigPath);
  if (plan.kind === "worktree-create" || plan.kind === "worktree-remove") return applyWorktreePlan(plan, options.selectedConfigPath);
  if (plan.kind === "coordination-create") return applyCoordinationCreatePlan(plan, options);
  if (plan.kind === "adopt") return applyAdoptPlan(plan, options);
  if (plan.kind === "workspace-primary") return applyPrimarySelectionPlan(plan, options);
  if (plan.kind === "workspace-edit") return applyWorkspaceChangePlan(plan, options);
  if (plan.kind === "catalog-edit") return applyCatalogChangePlan(plan, options);
  if (plan.kind === "import-v1") return applyImportPlan(plan, options);
  requireThat(plan.kind === "init", "UNSUPPORTED");
  const request = initRequest(plan.request);
  requireThat(options.selectedConfigPath === request.configPath, "STALE_PLAN");

  let derived: WorkspacePlan;
  try {
    derived = await createInitPlan(request, plan.createdAt);
  } catch (error) {
    if (
      error instanceof GovernanceError &&
      ["CONFLICT", "INVALID_CONFIG", "NOT_CONFIGURED"].includes(error.code)
    ) throw new GovernanceError("STALE_PLAN");
    throw error;
  }
  requireThat(
    canonicalJson(workspacePlanSemanticFields(derived)) ===
      canonicalJson(workspacePlanSemanticFields(plan)),
    "STALE_PLAN",
  );
  await requireLocksAbsent([
    request.catalogPath,
    request.localStatePath,
    request.configPath,
  ]);

  const documents = initDocuments(request);
  const catalog = await writeCatalogDocument(
    new FileCatalogStore(request.catalogPath),
    plan.inputRevisions.catalog,
    documents.catalog,
  );
  const localState = await writeLocalStateDocument(
    new FileLocalStateStore(request.localStatePath),
    plan.inputRevisions.localState,
    documents.localState,
  );
  const config = await writeConfigDocument(
    new FileConfigStore(request.configPath),
    plan.inputRevisions.config,
    documents.config,
  );
  requireThat(
    config.document !== null &&
      catalog.document !== null &&
      localState.document !== null,
    "ACTION_FAILED",
  );
  return {
    planId: plan.id,
    kind: plan.kind,
    revisions: {
      config: config.revision,
      catalog: catalog.revision,
      localState: localState.revision,
    },
    readback: {
      config: config.document,
      catalog: catalog.document,
      localState: localState.document,
    },
  };
}
