import { isAbsolute, resolve } from "node:path";
import { GovernanceError, requireThat } from "./core.ts";
import { readSelectedRegistry } from "./catalog-readback.ts";
import {
  contained,
  discoverGithub,
  discoverLocal,
  type CoverageStatus,
  type Inventory,
} from "./discovery.ts";
import {
  buildWorkspaceOverview,
  type OverviewSelection,
  type WorkspaceOverview,
} from "./overview.ts";

export interface ObserveWorkspaceRequest {
  sourceIds: string[];
  roots: string[];
  depth?: number;
  maxPages?: number;
}

function unavailableInventory(root: string, code: string): Inventory {
  return {
    root,
    complete: false,
    errors: [{ code, target: root }],
    repositories: [],
    occupiedPaths: [],
    unsafePaths: [],
  };
}

function normalizeRoot(root: string): string {
  requireThat(
    typeof root === "string" &&
      root.length > 0 &&
      root.length <= 16_384 &&
      isAbsolute(root) &&
      !/[\x00\r\n]/.test(root),
    "INVALID_CONFIG",
  );
  return resolve(root);
}

export async function observeWorkspace(
  configPath: string,
  request: ObserveWorkspaceRequest,
): Promise<WorkspaceOverview> {
  requireThat(
    request !== null &&
      typeof request === "object" &&
      Object.keys(request).every((key) =>
        ["sourceIds", "roots", "depth", "maxPages"].includes(key)
      ) &&
      Array.isArray(request.sourceIds) &&
      Array.isArray(request.roots),
    "INVALID_CONFIG",
  );
  const depth = request.depth ?? 8;
  const maxPages = request.maxPages ?? 100;
  requireThat(
    Number.isInteger(depth) && depth >= 0 && depth <= 32 &&
      Number.isInteger(maxPages) && maxPages >= 1 && maxPages <= 100,
    "INVALID_CONFIG",
  );
  requireThat(
    request.sourceIds.every((sourceId) =>
      typeof sourceId === "string" && sourceId.length > 0
    ) &&
      new Set(request.sourceIds).size === request.sourceIds.length,
    "INVALID_CONFIG",
  );
  const roots = request.roots.map(normalizeRoot);
  requireThat(new Set(roots).size === roots.length, "INVALID_CONFIG");

  const registry = await readSelectedRegistry(configPath);
  const sources = new Map(registry.catalog.sources.map((source) => [source.id, source]));
  requireThat(
    request.sourceIds.every((sourceId) => sources.has(sourceId)),
    "INVALID_CONFIG",
  );
  const trustedRoots = registry.config.trustedRoots.map((root) => resolve(root));
  const rootTrust = roots.map((root) =>
    trustedRoots.some((trustedRoot) => contained(trustedRoot, root))
  );

  // Complete all validation before invoking GitHub or Git. Observations then run
  // independently so one denied source or unsafe root cannot erase another result.
  const observedDate = new Date();
  const observedAt = observedDate.toISOString();
  const [remote, local] = await Promise.all([
    Promise.all(request.sourceIds.map(async (sourceId) => {
      const source = sources.get(sourceId)!;
      return {
        sourceId,
        inventory: await discoverGithub(source.owner, {
          ownerType: source.ownerType,
          maxPages,
          now: () => new Date(observedDate),
        }),
      };
    })),
    Promise.all(roots.map(async (root, index) => {
      if (!rootTrust[index]) {
        return {
          observedAt,
          inventory: unavailableInventory(root, "UNTRUSTED_ROOT"),
          status: "unknown" as CoverageStatus,
        };
      }
      try {
        const inventory = await discoverLocal(root, {
          depth,
          trustedMetadataRoots: trustedRoots,
        });
        return {
          observedAt,
          inventory,
          status: (inventory.complete ? "complete" : "partial") as CoverageStatus,
        };
      } catch (error) {
        const code = error instanceof GovernanceError && error.code === "INVALID"
          ? "INVALID_ROOT"
          : "SCAN_FAILURE";
        return {
          observedAt,
          inventory: unavailableInventory(root, code),
          status: "unknown" as CoverageStatus,
        };
      }
    })),
  ]);

  const selection: OverviewSelection = {
    sourceIds: [...request.sourceIds],
    roots,
    depth,
    maxPages,
    transient: true,
  };
  return buildWorkspaceOverview({
    catalog: registry.catalog,
    revisions: registry.revisions,
    observedAt,
    selection,
    remote,
    local,
  });
}
