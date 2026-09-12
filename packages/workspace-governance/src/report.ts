import {
  requireThat,
  resolvePolicyBatch,
  validateSnapshot,
  visibleNodes,
} from "./core.ts";
import type { Kind, Node, ResolveOptions, Resolution, Snapshot } from "./core.ts";
import type { Inventory } from "./discovery.ts";
import { createPlan } from "./planner.ts";
import type { PlanEntry } from "./planner.ts";

export type ReportNode = Pick<Node, "id" | "kind" | "slug" | "parentId"> & {
  label: string;
};

export interface ReportRepository extends PlanEntry {
  slug: string;
  ancestry: Pick<Node, "id" | "kind" | "slug">[];
  resolution: Resolution;
}

export interface ReportSummary {
  repositories: number;
  present: number;
  misplaced: number;
  missingCheckout: number;
  duplicate: number;
  blocked: number;
  needsAttention: number;
  drift: boolean;
}

export interface Report {
  apiVersion: "workspace-governance/report-v1";
  executable: false;
  authorityId: string;
  revision: string;
  nodeId: string;
  principal: string;
  authorization: Snapshot["authorization"];
  root: string;
  workflowId: string | null;
  policyFingerprint: string;
  inventoryDigest: string;
  summary: ReportSummary;
  nodes: ReportNode[];
  repositories: ReportRepository[];
}

function ancestry(byId: Map<string, ReportNode>, nodeId: string): ReportNode[] {
  const result: ReportNode[] = [];
  let node = byId.get(nodeId);
  requireThat(node, "UNAVAILABLE");
  while (node) {
    result.unshift(node);
    node = node.parentId === null ? undefined : byId.get(node.parentId);
  }
  return result;
}

export function createReport(
  snapshot: unknown,
  inventory: Inventory,
  nodeId: string,
  principal: string,
  options: ResolveOptions = {},
): Report {
  const current = validateSnapshot(snapshot);
  const plan = createPlan(current, inventory, nodeId, principal, options);
  const declaredById = new Map(current.manifest.nodes.map((node) => [node.id, node]));
  const visible: ReportNode[] = visibleNodes(current, principal).map(
    ({ id, kind, slug, parentId }) => ({
      id,
      kind,
      slug,
      label: declaredById.get(id)?.label ?? slug,
      parentId,
    }),
  );
  const byId = new Map(visible.map((node) => [node.id, node]));
  const scopeAncestry = ancestry(byId, nodeId);
  const scopeIds = new Set(scopeAncestry.map((node) => node.id));
  const nodes: ReportNode[] = visible
    .filter((node) => {
      const chain = ancestry(byId, node.id);
      return scopeIds.has(node.id) || chain.some((ancestor) => ancestor.id === nodeId);
    })
    .map(({ id, kind, slug, label, parentId }) => ({ id, kind, slug, label, parentId }));
  const resolutions = resolvePolicyBatch(
    current,
    plan.entries.map((entry) => entry.repositoryId),
    principal,
    options,
  );
  const repositories = plan.entries.map((entry, index): ReportRepository => {
    const node = byId.get(entry.repositoryId);
    requireThat(node?.kind === ("repository" satisfies Kind));
    return {
      ...entry,
      slug: node.slug,
      ancestry: ancestry(byId, node.id).map(({ id, kind, slug }) => ({ id, kind, slug })),
      resolution: resolutions[index],
    };
  });
  const count = (status: PlanEntry["status"]) =>
    repositories.filter((repository) => repository.status === status).length;
  const present = count("present");
  const summary: ReportSummary = {
    repositories: repositories.length,
    present,
    misplaced: count("misplaced"),
    missingCheckout: count("missing-checkout"),
    duplicate: count("duplicate"),
    blocked: count("blocked"),
    needsAttention: repositories.length - present,
    drift: repositories.length !== present,
  };
  return {
    apiVersion: "workspace-governance/report-v1",
    executable: false,
    authorityId: plan.authorityId,
    revision: plan.revision,
    nodeId: plan.nodeId,
    principal: plan.principal,
    authorization: plan.authorization,
    root: plan.root,
    workflowId: plan.workflowId,
    policyFingerprint: plan.policyFingerprint,
    inventoryDigest: plan.inventoryDigest,
    summary,
    nodes,
    repositories,
  };
}
