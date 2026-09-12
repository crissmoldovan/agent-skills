import { createHash } from "node:crypto";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import {
  validateSnapshot,
  resolvePolicy,
  visibleNodes,
  resolvePolicyBatch,
  requireThat,
  canonicalJson,
  digest,
  canonicalRemote,
} from "./core.ts";
import type { ResolveOptions, Snapshot, Node } from "./core.ts";
import type { Inventory } from "./discovery.ts";
export interface PlanEntry {
  repositoryId: string;
  remote: string;
  target: string;
  status:
    "present" | "missing-checkout" | "misplaced" | "duplicate" | "blocked";
  presentPaths: string[];
  dirty: boolean;
}
export interface Plan {
  apiVersion: "workspace-governance/plan-v1";
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
  entries: PlanEntry[];
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const contained = (root: string, path: string) => {
  const r = relative(root, path);
  return (
    r === "" || (!r.startsWith(".." + sep) && r !== ".." && !isAbsolute(r))
  );
};
function checkedInventory(input: Inventory): Inventory {
  requireThat(
    input && typeof input === "object" && Array.isArray(input.repositories),
  );
  // Porcelain is a bounded subprocess blob, not a manifest text field. Hash it
  // before canonical envelope validation; all its bytes still affect freshness.
  const observations = input.repositories.map((r) => {
    requireThat(
      r &&
        typeof r === "object" &&
        typeof r.status === "string" &&
        Buffer.byteLength(r.status, "utf8") <= 2 * 1024 * 1024,
    );
    return {
      ...r,
      status: createHash("sha256").update(r.status, "utf8").digest("hex"),
    };
  });
  const normalized = { ...input, repositories: observations };
  canonicalJson(normalized);
  const i = structuredClone(normalized);
  requireThat(
    i &&
      typeof i === "object" &&
      Object.keys(i).sort().join(",") ===
        "complete,errors,occupiedPaths,repositories,root,unsafePaths",
  );
  requireThat(
    typeof i.root === "string" &&
      isAbsolute(i.root) &&
      resolve(i.root) === i.root,
  );
  requireThat(
    typeof i.complete === "boolean" &&
      Array.isArray(i.errors) &&
      Array.isArray(i.repositories) &&
      Array.isArray(i.occupiedPaths) &&
      Array.isArray(i.unsafePaths),
  );
  const path = (p: unknown) =>
    requireThat(
      typeof p === "string" &&
        isAbsolute(p) &&
        resolve(p) === p &&
        contained(i.root, p),
    );
  for (const p of [...i.occupiedPaths, ...i.unsafePaths]) path(p);
  for (const r of i.repositories) {
    requireThat(
      Object.keys(r).sort().join(",") ===
        "dirty,head,path,remote,status,worktree",
    );
    path(r.path);
    requireThat(
      r.remote === null ||
        (typeof r.remote === "string" &&
          canonicalRemote(r.remote) === r.remote),
    );
    requireThat(
      r.head === null ||
        (typeof r.head === "string" &&
          /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(r.head)),
    );
    requireThat(
      typeof r.dirty === "boolean" &&
        typeof r.worktree === "boolean" &&
        typeof r.status === "string",
    );
  }
  requireThat(
    new Set(i.repositories.map((r) => r.path)).size === i.repositories.length,
  );
  for (const e of i.errors)
    requireThat(
      e && Object.keys(e).join(",") === "code" && typeof e.code === "string",
    );
  requireThat(
    i.complete &&
      i.errors.length === 0 &&
      i.repositories.every((r) => r.remote !== null),
    "INCOMPLETE",
  );
  i.repositories.sort((a, b) => compare(canonicalJson(a), canonicalJson(b)));
  i.occupiedPaths = [...new Set(i.occupiedPaths)].sort(compare);
  i.unsafePaths = [...new Set(i.unsafePaths)].sort(compare);
  i.errors.sort((a, b) => compare(a.code, b.code));
  return i;
}
export function createPlan(
  snapshot: unknown,
  inventory: Inventory,
  nodeId: string,
  principal: string,
  options: ResolveOptions = {},
): Plan {
  const s = validateSnapshot(snapshot);
  const scopeResolution = resolvePolicy(s, nodeId, principal, options);
  const scope = s.manifest.nodes.find((n) => n.id === nodeId)!;
  requireThat(
    ["user", "domain", "namespace", "organization", "area", "project", "repository"].includes(scope.kind),
    "UNSUPPORTED",
  );
  const byId = new Map(s.manifest.nodes.map((n) => [n.id, n]));
  const chain = (id: string): Node[] => {
    const out: Node[] = [];
    let n = byId.get(id);
    while (n) {
      out.unshift(n);
      n = n.parentId === null ? undefined : byId.get(n.parentId);
    }
    return out;
  };
  const selected = s.manifest.nodes.filter((n) =>
    chain(n.id).some((p) => p.id === nodeId),
  );
  const readableIds = new Set(visibleNodes(s, principal).map((n) => n.id));
  requireThat(
    selected.every((n) => readableIds.has(n.id)),
    "UNAVAILABLE",
  );
  const inv = checkedInventory(inventory);
  const repos = selected
    .filter((n) => n.kind === "repository")
    .sort((a, b) => compare(a.id, b.id));
  const resolutions = [
    scopeResolution,
    ...resolvePolicyBatch(
      s,
      repos.map((n) => n.id),
      principal,
      options,
    ),
  ];
  const entries: PlanEntry[] = repos.map((n) => {
    const target = join(
      inv.root,
      ...chain(n.id)
        .filter((n) => n.kind !== "user" && n.kind !== "workspace")
        .map((n) => n.slug),
    );
    requireThat(contained(inv.root, target));
    const matched = inv.repositories.filter((r) => r.remote === n.remote);
    const dirty = matched.some((r) => r.dirty);
    let status: PlanEntry["status"] =
      matched.length > 1
        ? "duplicate"
        : matched.length === 0
          ? "missing-checkout"
          : matched[0].path === target
            ? "present"
            : "misplaced";
    const unsafe = inv.unsafePaths.some((p) =>
      contained(p.toLowerCase(), target.toLowerCase()),
    );
    const collision =
      inv.occupiedPaths.some(
        (p) => p !== target && p.toLowerCase() === target.toLowerCase(),
      ) ||
      inv.occupiedPaths.some(
        (p) =>
          p !== target &&
          contained(p.toLowerCase(), target.toLowerCase()) &&
          !contained(p, target),
      );
    const occupied =
      inv.occupiedPaths.includes(target) &&
      !matched.some((r) => r.path === target);
    if (unsafe || collision || occupied || (dirty && matched.length <= 1))
      status = "blocked";
    return {
      repositoryId: n.id,
      remote: n.remote!,
      target,
      status,
      presentPaths: matched.map((r) => r.path).sort(compare),
      dirty,
    };
  });
  for (const e of entries)
    if (
      entries.some(
        (other) =>
          other !== e && other.target.toLowerCase() === e.target.toLowerCase(),
      )
    )
      e.status = "blocked";
  return {
    apiVersion: "workspace-governance/plan-v1",
    executable: false,
    authorityId: s.manifest.authorityId,
    revision: s.revision,
    nodeId,
    principal,
    authorization: s.authorization,
    root: inv.root,
    workflowId: options.workflowId ?? null,
    policyFingerprint: digest(resolutions),
    inventoryDigest: digest(inv),
    entries,
  };
}
export function verifyPlan(
  plan: unknown,
  snapshot: unknown,
  inventory: Inventory,
  nodeId: string,
  principal: string,
  options: ResolveOptions = {},
): void {
  const current = createPlan(snapshot, inventory, nodeId, principal, options);
  requireThat(canonicalJson(plan) === canonicalJson(current), "STALE_PLAN");
}
