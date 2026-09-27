import { canonicalRemote, GovernanceError, requireThat } from "./core.ts";
import {
  createBuiltinStoreRegistry,
  type StoreAdapterRegistry,
} from "./document-stores.ts";
import { loadWorkspacesConfig } from "./registry-plans.ts";
import type {
  CatalogDocument,
  LocalStateDocument,
  RepositoryRecord,
  RepositoryWorkspace,
  WorkspacesConfig,
} from "./v2-model.ts";
import { validateCatalogDocument, validateLocalStateDocument } from "./v2-model.ts";

export interface SelectedRegistry {
  config: WorkspacesConfig;
  catalog: CatalogDocument;
  localState: LocalStateDocument;
  revisions: {
    config: string;
    catalog: string;
    localState: string;
  };
}

export interface CatalogCounts {
  classified: number;
  unclassified: number;
  total: number;
}

export interface CatalogListResult {
  revisions: SelectedRegistry["revisions"];
  counts: CatalogCounts;
  repositories: Array<RepositoryRecord & { workspaceState: "unknown" }>;
}

export interface CatalogDraft {
  format: "workspacectl-edit/1";
  target: "catalog" | "user";
  expectedRevision: string;
  document: CatalogDocument;
}

export interface LocalStateDraft {
  format: "workspacectl-edit/1";
  target: "workspace";
  workspaceId: string;
  expectedRevision: string;
  document: LocalStateDocument;
}

export interface RepositoryLookupResult {
  revisions: SelectedRegistry["revisions"];
  repository: RepositoryRecord;
  match: { kind: "id" | "remote" | "alias"; value: string };
  selectedWorkspace: RepositoryWorkspace | null;
  alternatives: RepositoryWorkspace[];
}

export async function lookupRepository(
  configPath: string,
  target: string,
): Promise<RepositoryLookupResult> {
  requireThat(typeof target === "string" && target.length > 0 && target.length <= 16_384, "INVALID_CONFIG");
  const registry = await readSelectedRegistry(configPath);
  let matches: RepositoryRecord[] = [];
  let kind: RepositoryLookupResult["match"]["kind"] = "id";
  const byId = registry.catalog.repositories.find((repository) => repository.id === target);
  if (byId !== undefined) matches = [byId];
  else {
    try {
      const remote = canonicalRemote(target);
      matches = registry.catalog.repositories.filter(
        (repository) => canonicalRemote(repository.remote) === remote,
      );
      kind = "remote";
    } catch {
      matches = [];
    }
    if (matches.length === 0) {
      const alias = target.toLowerCase();
      matches = registry.catalog.repositories.filter((repository) =>
        repository.aliases.some((candidate) => candidate.toLowerCase() === alias)
      );
      kind = "alias";
    }
  }
  matches.sort((left, right) => left.id.localeCompare(right.id));
  if (matches.length === 0) throw new GovernanceError("NOT_FOUND");
  if (matches.length !== 1) {
    throw new GovernanceError("AMBIGUOUS", {
      candidates: matches.map((repository) => ({ id: repository.id, remote: repository.remote })),
    });
  }
  const repository = matches[0];
  const workspaces = registry.localState.repositoryWorkspaces
    .filter((workspace) => workspace.repositoryId === repository.id)
    .sort((left, right) => left.id.localeCompare(right.id));
  const selected = workspaces.filter((workspace) => workspace.primarySelected);
  if (selected.length > 1) {
    throw new GovernanceError("AMBIGUOUS", {
      candidates: selected.map((workspace) => ({
        id: workspace.id,
        kind: workspace.kind,
        path: workspace.path,
      })),
    });
  }
  return {
    revisions: registry.revisions,
    repository: structuredClone(repository),
    match: { kind, value: target },
    selectedWorkspace: selected[0] === undefined ? null : structuredClone(selected[0]),
    alternatives: workspaces
      .filter((workspace) => workspace.id !== selected[0]?.id)
      .map((workspace) => structuredClone(workspace)),
  };
}

export function validateCatalogDraft(input: unknown): CatalogDraft {
  requireThat(input !== null && typeof input === "object" && !Array.isArray(input), "INVALID_CONFIG");
  const value = input as Record<string, unknown>;
  requireThat(
    Object.keys(value).length === 4 &&
      ["format", "target", "expectedRevision", "document"].every((key) => Object.hasOwn(value, key)),
    "INVALID_CONFIG",
  );
  requireThat(value.format === "workspacectl-edit/1" && ["catalog", "user"].includes(value.target as string), "INVALID_CONFIG");
  requireThat(
    typeof value.expectedRevision === "string" && /^sha256:[a-f0-9]{64}$/.test(value.expectedRevision),
    "INVALID_CONFIG",
  );
  return {
    format: "workspacectl-edit/1",
    target: value.target as "catalog" | "user",
    expectedRevision: value.expectedRevision,
    document: validateCatalogDocument(value.document),
  };
}

export function validateLocalStateDraft(input: unknown): LocalStateDraft {
  requireThat(input !== null && typeof input === "object" && !Array.isArray(input), "INVALID_CONFIG");
  const value = input as Record<string, unknown>;
  requireThat(Object.keys(value).length === 5 && ["format", "target", "workspaceId", "expectedRevision", "document"].every((key) => Object.hasOwn(value, key)), "INVALID_CONFIG");
  requireThat(value.format === "workspacectl-edit/1" && value.target === "workspace", "INVALID_CONFIG");
  requireThat(typeof value.workspaceId === "string" && value.workspaceId.length > 0 && typeof value.expectedRevision === "string" && /^sha256:[a-f0-9]{64}$/.test(value.expectedRevision), "INVALID_CONFIG");
  const document = validateLocalStateDocument(value.document);
  requireThat(document.repositoryWorkspaces.some((workspace) => workspace.id === value.workspaceId), "INVALID_CONFIG");
  return { format: "workspacectl-edit/1", target: "workspace", workspaceId: value.workspaceId, expectedRevision: value.expectedRevision, document };
}

export async function readSelectedRegistry(
  configPath: string,
  registry: StoreAdapterRegistry = createBuiltinStoreRegistry(),
): Promise<SelectedRegistry> {
  const loadedConfig = await loadWorkspacesConfig(configPath);
  const config = loadedConfig.document;

  const [catalog, localState] = await Promise.all([
    registry.createCatalog(config.catalog.adapter, config.catalog.path).read(),
    registry.createLocalState(config.localState.adapter, config.localState.path).read(),
  ]);
  requireThat(
    catalog.document !== null &&
      catalog.capabilities.read === true &&
      catalog.freshness === "current",
    "UNAVAILABLE",
  );
  requireThat(
    localState.document !== null &&
      localState.capabilities.read === true &&
      localState.freshness === "current" &&
      localState.document.selectedConfig.path === configPath &&
      localState.document.selectedConfig.revision === loadedConfig.revision,
    "UNAVAILABLE",
  );
  return {
    config,
    catalog: catalog.document,
    localState: localState.document,
    revisions: {
      config: loadedConfig.revision,
      catalog: catalog.revision,
      localState: localState.revision,
    },
  };
}

function countsFor(catalog: CatalogDocument): CatalogCounts {
  const unclassified = catalog.repositories.filter(
    (repository) => repository.classification === "unclassified",
  ).length;
  return {
    classified: catalog.repositories.length - unclassified,
    unclassified,
    total: catalog.repositories.length,
  };
}

export async function listCatalog(
  configPath: string,
  storeRegistry: StoreAdapterRegistry = createBuiltinStoreRegistry(),
): Promise<CatalogListResult> {
  const registry = await readSelectedRegistry(configPath, storeRegistry);
  return {
    revisions: registry.revisions,
    counts: countsFor(registry.catalog),
    repositories: registry.catalog.repositories.map((repository) => ({
      ...structuredClone(repository),
      workspaceState: "unknown",
    })),
  };
}

export async function exportCatalogDraft(
  configPath: string,
  target: "catalog" | "user" = "catalog",
): Promise<CatalogDraft> {
  const registry = await readSelectedRegistry(configPath);
  return {
    format: "workspacectl-edit/1",
    target,
    expectedRevision: registry.revisions.catalog,
    document: structuredClone(registry.catalog),
  };
}

export async function exportLocalStateDraft(
  configPath: string,
  workspaceId: string,
  storeRegistry: StoreAdapterRegistry = createBuiltinStoreRegistry(),
): Promise<LocalStateDraft> {
  const registry = await readSelectedRegistry(configPath, storeRegistry);
  requireThat(registry.localState.repositoryWorkspaces.some((workspace) => workspace.id === workspaceId), "NOT_FOUND");
  return { format: "workspacectl-edit/1", target: "workspace", workspaceId, expectedRevision: registry.revisions.localState, document: structuredClone(registry.localState) };
}
