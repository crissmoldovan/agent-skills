import {
  canonicalJson,
  canonicalRemote,
  digest,
  GovernanceError,
  requireThat,
  validateManifest,
} from "./core.ts";
import type { Json, Manifest, Node } from "./core.ts";
import { validateCatalogDocument } from "./v2-model.ts";
import type {
  CatalogDocument,
  GroupRecord,
  RepositoryRecord,
} from "./v2-model.ts";

export interface UnclassifiedRepositoryV1 {
  repository: string;
  status: "unclassified";
  reason: string;
  [key: string]: Json;
}

export interface UnclassifiedSidecarV1 {
  apiVersion: "workspace-governance/unclassified-repositories-v1";
  repositories: UnclassifiedRepositoryV1[];
}

const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

function sidecarToken(value: unknown, source: string): string {
  const invalid = (): never => {
    throw new GovernanceError("INVALID_CONFIG", {
      invalidRemoteTokens: [{ source, value: value as Json }],
    });
  };
  if (
    typeof value !== "string" ||
    value.length > 141 ||
    !/^[^/]+\/[^/]+$/.test(value)
  ) invalid();
  const token = value as string;
  try {
    canonicalRemote(`https://github.com/${token}`);
  } catch {
    invalid();
  }
  if (token.slice(token.indexOf("/") + 1).toLowerCase().endsWith(".git"))
    invalid();
  return token;
}

export function validateUnclassifiedSidecar(
  input: unknown,
): UnclassifiedSidecarV1 {
  try {
    canonicalJson(input);
  } catch {
    throw new GovernanceError("INVALID_CONFIG");
  }
  requireThat(plain(input), "INVALID_CONFIG");
  requireThat(
    input.apiVersion === "workspace-governance/unclassified-repositories-v1" &&
      Array.isArray(input.repositories) &&
      input.repositories.length <= 10_000,
    "INVALID_CONFIG",
  );
  const repositories: UnclassifiedRepositoryV1[] = [];
  for (const [index, record] of input.repositories.entries()) {
    requireThat(
      plain(record) &&
        Object.hasOwn(record, "repository") &&
        Object.hasOwn(record, "status") &&
        Object.hasOwn(record, "reason"),
      "INVALID_CONFIG",
    );
    const repository = sidecarToken(
      record.repository,
      `sidecar.repositories[${index}].repository`,
    );
    requireThat(record.status === "unclassified", "INVALID_CONFIG");
    requireThat(
      typeof record.reason === "string" &&
        record.reason.length > 0 &&
        record.reason.length <= 16_384 &&
        record.reason.trim() === record.reason &&
        !/[\x00-\x1f\x7f]/.test(record.reason),
      "INVALID_CONFIG",
    );
    repositories.push({
      ...structuredClone(record),
      repository,
      status: "unclassified",
      reason: record.reason,
    } as UnclassifiedRepositoryV1);
  }
  if (Object.hasOwn(input, "count"))
    requireThat(
      Number.isSafeInteger(input.count) &&
        input.count === repositories.length,
      "INVALID_CONFIG",
    );
  return structuredClone({ ...input, repositories }) as UnclassifiedSidecarV1;
}

function validatedManifest(input: unknown): Manifest {
  try {
    return validateManifest(input);
  } catch (error) {
    if (error instanceof GovernanceError && error.code !== "INVALID") throw error;
    throw new GovernanceError("INVALID_CONFIG");
  }
}

const groupKinds = new Set(["domain", "organization", "area", "project"]);

function nameFor(node: Node): string {
  return node.label ?? node.slug;
}

function aliasesFor(node: Node): string[] {
  const candidates = [node.label, node.slug].filter(
    (value): value is string => value !== undefined,
  );
  return candidates.filter(
    (value, index) =>
      candidates.findIndex(
        (candidate) => candidate.toLowerCase() === value.toLowerCase(),
      ) === index,
  );
}

function migrationRecord(
  source: "classified" | "unclassified",
  record: Json,
): Record<string, Json> {
  return { migration: { source, record } };
}

function nearestGroupId(
  node: Node,
  nodes: Map<string, Node>,
): string | null {
  let parentId = node.parentId;
  while (parentId !== null) {
    const parent = nodes.get(parentId);
    requireThat(parent !== undefined, "INVALID_CONFIG");
    if (groupKinds.has(parent.kind)) return parent.id;
    parentId = parent.parentId;
  }
  return null;
}

function sidecarTopLevel(sidecar: UnclassifiedSidecarV1): Record<string, Json> {
  return Object.fromEntries(
    Object.entries(sidecar)
      .filter(([key]) => key !== "repositories")
      .map(([key, value]) => [key, structuredClone(value)]),
  );
}

export function convertV1Catalog(
  manifestInput: unknown,
  sidecarInput: unknown,
): CatalogDocument {
  const manifest = validatedManifest(manifestInput);
  const sidecar = validateUnclassifiedSidecar(sidecarInput);
  const unmappable: Array<{ source: string; record: Json }> = [];
  manifest.nodes.forEach((node, index) => {
    if (node.visibility !== undefined) {
      const harmlessRootDefault =
        node.parentId === null &&
        node.visibility.mode === "public" &&
        node.visibility.readers.length === 0;
      if (!harmlessRootDefault)
        unmappable.push({
          source: `manifest.nodes[${index}].visibility`,
          record: structuredClone(node.visibility) as unknown as Json,
        });
    }
    if (node.kind === "workspace")
      unmappable.push({
        source: `manifest.nodes[${index}]`,
        record: structuredClone(node) as unknown as Json,
      });
  });
  manifest.policies.forEach((record, index) =>
    unmappable.push({
      source: `manifest.policies[${index}]`,
      record: structuredClone(record) as unknown as Json,
    }),
  );
  manifest.workflows.forEach((record, index) =>
    unmappable.push({
      source: `manifest.workflows[${index}]`,
      record: structuredClone(record) as unknown as Json,
    }),
  );
  if (unmappable.length > 0)
    throw new GovernanceError("UNSUPPORTED", { unmappable });
  const nodes = new Map(manifest.nodes.map((node) => [node.id, node]));

  const groups: GroupRecord[] = manifest.nodes
    .filter((node) => groupKinds.has(node.kind))
    .map((node) => ({
      id: node.id,
      kind:
        node.kind === "domain" || node.kind === "organization"
          ? "organization"
          : node.kind as "area" | "project",
      name: nameFor(node),
      slug: node.slug,
      parentId: nearestGroupId(node, nodes),
      metadata: migrationRecord("classified", node as unknown as Json),
    }));

  const repositories: RepositoryRecord[] = manifest.nodes
    .filter((node) => node.kind === "repository")
    .map((node) => ({
      id: node.id,
      remote: node.remote!,
      sourceId: null,
      primaryGroupId: nearestGroupId(node, nodes),
      memberOf: [],
      aliases: aliasesFor(node),
      classification: "confirmed",
      metadata: migrationRecord("classified", node as unknown as Json),
    }));

  const identities = new Map<string, Array<{ source: string; id: string }>>();
  const remember = (remote: string, source: string, id: string): void => {
    const canonical = canonicalRemote(remote).slice("https://github.com/".length);
    const occurrences = identities.get(canonical) ?? [];
    occurrences.push({ source, id });
    identities.set(canonical, occurrences);
  };
  for (const repository of repositories)
    remember(repository.remote, "classified", repository.id);

  const ids = new Set([
    ...groups.map((group) => group.id),
    ...repositories.map((repository) => repository.id),
  ]);
  for (const record of sidecar.repositories) {
    const remote = canonicalRemote(`https://github.com/${record.repository}`);
    const canonical = remote;
    const id = `repo-unclassified-${digest({ canonical }).slice(0, 24)}`;
    remember(remote, "unclassified", id);
    requireThat(!ids.has(id), "CONFLICT");
    ids.add(id);
    repositories.push({
      id,
      remote,
      sourceId: null,
      primaryGroupId: null,
      memberOf: [],
      aliases: [record.repository.slice(record.repository.indexOf("/") + 1)],
      classification: "unclassified",
      metadata: migrationRecord("unclassified", record as unknown as Json),
    });
  }

  const conflicts = [...identities.entries()]
    .filter(([, occurrences]) => occurrences.length > 1)
    .map(([canonical, occurrences]) => ({ canonical, occurrences }));
  if (conflicts.length > 0)
    throw new GovernanceError("CONFLICT", { conflicts });


  const omittedNodes = manifest.nodes.filter(
    (node) => !groupKinds.has(node.kind) && node.kind !== "repository",
  );
  const catalog: CatalogDocument = {
    schemaVersion: 2,
    documentType: "workspacectl/catalog",
    groups,
    repositories,
    sources: [],
    policies: [],
    workflows: [],
    metadata: {
      migration: {
        format: "workspacectl/import-v1",
        classified: {
          apiVersion: manifest.apiVersion,
          authorityId: manifest.authorityId,
          metadata: manifest.metadata,
          omittedNodes: omittedNodes as unknown as Json,
        },
        unclassified: { topLevel: sidecarTopLevel(sidecar) },
      },
    },
  };
  return validateCatalogDocument(catalog);
}
