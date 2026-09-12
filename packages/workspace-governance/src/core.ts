import { createHash } from "node:crypto";
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type Kind =
  | "user"
  | "domain"
  | "namespace"
  | "organization"
  | "area"
  | "project"
  | "repository"
  | "workspace";
export interface Node {
  id: string;
  kind: Kind;
  slug: string;
  label?: string;
  parentId: string | null;
  remote?: string;
  metadata?: Record<string, Json>;
  visibility?: { mode: "public" | "restricted"; readers: string[] };
}
export type Setting =
  | { key: string; merge: "remove" }
  | {
      key: string;
      merge: "replace" | "deep-merge" | "append" | "set-union" | "keyed-merge";
      value: Json;
    };
export interface Constraint {
  id: string;
  key: string;
  operator: "equals" | "forbidden-values" | "required-members";
  value: Json;
}
export interface Policy {
  nodeId: string;
  settings: Setting[];
  constraints: Constraint[];
}
export type Step =
  | { id: string; action: string; inputs: Record<string, Json> }
  | { id: string; remove: true };
export interface Workflow extends Policy {
  id: string;
  steps: Step[];
}
export interface Manifest {
  apiVersion: "workspace-governance/v1";
  authorityId: string;
  nodes: Node[];
  policies: Policy[];
  workflows: Workflow[];
  metadata: Record<string, Json>;
}
export class GovernanceError extends Error {
  code: string;
  constructor(code = "INVALID") {
    super(
      (
        {
          UNAVAILABLE: "Resource unavailable.",
          INCOMPLETE: "Observation incomplete.",
          STALE_PLAN: "Preview is stale.",
          UNSUPPORTED: "Operation unsupported.",
          TOOL_FAILURE: "Observation tool failed.",
          CONSTRAINT: "Policy constraint failed.",
        } as Record<string, string>
      )[code] ?? "Invalid input.",
    );
    this.name = "GovernanceError";
    this.code = code;
  }
}
export function requireThat(ok: unknown, code = "INVALID"): asserts ok {
  if (!ok) throw new GovernanceError(code);
}
const unsafe = new Set(["__proto__", "prototype", "constructor"]);
const plain = (x: unknown): x is Record<string, any> =>
  !!x &&
  typeof x === "object" &&
  !Array.isArray(x) &&
  (Object.getPrototypeOf(x) === Object.prototype ||
    Object.getPrototypeOf(x) === null);
function bounded(x: unknown, depth = 0, budget = { n: 0 }): asserts x is Json {
  requireThat(depth <= 32 && ++budget.n <= 200000);
  if (x === null || typeof x === "boolean") return;
  if (typeof x === "number") {
    requireThat(Number.isFinite(x));
    return;
  }
  if (typeof x === "string") {
    requireThat(x.length <= 16384);
    return;
  }
  requireThat(Array.isArray(x) || plain(x));
  if (Array.isArray(x))
    requireThat(
      Object.keys(x).length === x.length &&
        Array.from({ length: x.length }, (_, i) => Object.hasOwn(x, i)).every(
          Boolean,
        ),
    );
  for (const [k, v] of Object.entries(x)) {
    requireThat(!unsafe.has(k) && k.length <= 16384);
    bounded(v, depth + 1, budget);
  }
}
function codepointCompare(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0)!);
  const y = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++)
    if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}
export function canonicalJson(x: unknown): string {
  bounded(x);
  const encode = (v: Json): string =>
    Array.isArray(v)
      ? "[" + v.map(encode).join(",") + "]"
      : plain(v)
        ? "{" +
          Object.keys(v)
            .sort(codepointCompare)
            .map((k) => JSON.stringify(k) + ":" + encode(v[k]))
            .join(",") +
          "}"
        : JSON.stringify(v);
  return encode(x);
}
export function digest(x: unknown): string {
  return createHash("sha256").update(canonicalJson(x)).digest("hex");
}
/** Bounded recursive descent: JSON.parse alone silently accepts duplicate keys. */
export function parseJson(text: string): unknown {
  requireThat(
    typeof text === "string" &&
      Buffer.byteLength(text, "utf8") <= 2 * 1024 * 1024,
  );
  let i = 0;
  const ws = () => {
    while (/[\x20\t\r\n]/.test(text[i] ?? "!")) i++;
  };
  const str = (): string => {
    const start = i++;
    while (i < text.length) {
      if (text[i] === "\\") {
        i += 2;
        continue;
      }
      if (text[i++] === '"') {
        try {
          return JSON.parse(text.slice(start, i));
        } catch {
          throw new GovernanceError();
        }
      }
    }
    throw new GovernanceError();
  };
  const val = (depth: number): unknown => {
    requireThat(depth <= 32);
    ws();
    const c = text[i];
    if (c === '"') return str();
    if (c === "{" || c === "[") {
      i++;
      ws();
      const obj =
        c === "{" ? ({} as Record<string, unknown>) : ([] as unknown[]);
      const end = c === "{" ? "}" : "]";
      const seen = new Set<string>();
      if (text[i] === end) {
        i++;
        return obj;
      }
      while (true) {
        ws();
        if (Array.isArray(obj)) obj.push(val(depth + 1));
        else {
          requireThat(text[i] === '"');
          const k = str();
          requireThat(!seen.has(k) && !unsafe.has(k));
          seen.add(k);
          ws();
          requireThat(text[i++] === ":");
          obj[k] = val(depth + 1);
        }
        ws();
        if (text[i] === end) {
          i++;
          return obj;
        }
        requireThat(text[i++] === ",");
      }
    }
    const m =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        text.slice(i),
      );
    requireThat(m);
    i += m[0].length;
    return JSON.parse(m[0]);
  };
  try {
    const out = val(0);
    ws();
    requireThat(i === text.length);
    bounded(out);
    return out;
  } catch {
    throw new GovernanceError();
  }
}
const ownerPattern = "[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*";
export function validOwner(owner: string): boolean {
  return (
    typeof owner === "string" &&
    owner.length <= 39 &&
    new RegExp("^" + ownerPattern + "$").test(owner)
  );
}
export function canonicalRemote(input: string): string {
  requireThat(typeof input === "string");
  const m =
    /^(?:https:\/\/github\.com\/([^/]+)\/([^/]+)\/?|git@github\.com:([^/]+)\/([^/]+)|ssh:\/\/git@github\.com\/([^/]+)\/([^/]+))$/.exec(
      input,
    );
  requireThat(m);
  const owner = m[1] ?? m[3] ?? m[5];
  let repo = m[2] ?? m[4] ?? m[6];
  requireThat(validOwner(owner));
  if (repo.endsWith(".git")) repo = repo.slice(0, -4);
  requireThat(
    repo.length <= 100 &&
      /^[A-Za-z0-9_.-]+$/.test(repo) &&
      repo !== "." &&
      repo !== ".." &&
      !repo.endsWith("."),
  );
  return `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`;
}
function keys(
  x: unknown,
  required: string[],
  optional: string[] = [],
): asserts x is Record<string, any> {
  requireThat(plain(x));
  requireThat(
    required.every((k) => Object.hasOwn(x, k)) &&
      Object.keys(x).every((k) => required.includes(k) || optional.includes(k)),
  );
}
function id(x: unknown): asserts x is string {
  requireThat(
    typeof x === "string" &&
      x.length > 0 &&
      x.length <= 16384 &&
      !/[\x00-\x1f/\\]/.test(x) &&
      !unsafe.has(x),
  );
}
function field(x: unknown): asserts x is string {
  id(x);
  requireThat(x.split(".").every((s) => s.length > 0 && !unsafe.has(s)));
}
function unique(a: string[]) {
  requireThat(new Set(a).size === a.length);
}
function settings(x: unknown): asserts x is Setting[] {
  requireThat(Array.isArray(x) && x.length <= 20000);
  for (const s of x) {
    keys(s, ["key", "merge"], ["value"]);
    field(s.key);
    if (s.merge === "remove") {
      requireThat(!Object.hasOwn(s, "value"));
      continue;
    }
    requireThat(
      Object.hasOwn(s, "value") &&
        [
          "replace",
          "deep-merge",
          "append",
          "set-union",
          "keyed-merge",
        ].includes(s.merge),
    );
    if (s.merge === "deep-merge") requireThat(plain(s.value));
    if (["append", "set-union", "keyed-merge"].includes(s.merge))
      requireThat(Array.isArray(s.value));
    if (s.merge === "keyed-merge") {
      for (const v of s.value) {
        requireThat(plain(v));
        id(v.id);
      }
      unique(s.value.map((v: any) => v.id));
    }
  }
  unique(x.map((s) => s.key));
}
function constraints(x: unknown): asserts x is Constraint[] {
  requireThat(Array.isArray(x) && x.length <= 20000);
  for (const c of x) {
    keys(c, ["id", "key", "operator", "value"]);
    id(c.id);
    field(c.key);
    requireThat(
      ["equals", "forbidden-values", "required-members"].includes(c.operator),
    );
    if (c.operator !== "equals") requireThat(Array.isArray(c.value));
  }
  unique(x.map((c) => c.id));
}
export function validateManifest(input: unknown): Manifest {
  bounded(input);
  const m: Record<string, any> = structuredClone(input) as Record<string, any>;
  keys(m, [
    "apiVersion",
    "authorityId",
    "nodes",
    "policies",
    "workflows",
    "metadata",
  ]);
  requireThat(m.apiVersion === "workspace-governance/v1");
  id(m.authorityId);
  requireThat(plain(m.metadata));
  requireThat(
    Array.isArray(m.nodes) && m.nodes.length > 0 && m.nodes.length <= 10000,
  );
  requireThat(Array.isArray(m.policies) && Array.isArray(m.workflows));
  const kinds: Record<Kind, Kind[]> = {
    user: [],
    domain: ["user"],
    namespace: ["domain"],
    organization: ["user"],
    area: ["namespace", "organization", "area"],
    project: ["namespace", "organization", "area"],
    repository: ["namespace", "area", "project"],
    workspace: ["repository"],
  };
  for (const n of m.nodes) {
    keys(
      n,
      ["id", "kind", "slug", "parentId"],
      ["label", "remote", "metadata", "visibility"],
    );
    id(n.id);
    requireThat(!["$defaults", "$invocation"].includes(n.id));
    requireThat(Object.hasOwn(kinds, n.kind));
    requireThat(
      typeof n.slug === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(n.slug) &&
        !n.slug.endsWith(".") &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(n.slug),
    );
    if (n.label !== undefined)
      requireThat(
        typeof n.label === "string" &&
          n.label.length > 0 &&
          [...n.label].length <= 256 &&
          n.label.trim() === n.label &&
          !/[\x00-\x1f\x7f]/.test(n.label),
      );
    requireThat(n.parentId === null || typeof n.parentId === "string");
    if (n.kind === "repository")
      requireThat(
        typeof n.remote === "string" && canonicalRemote(n.remote) === n.remote,
      );
    else requireThat(!Object.hasOwn(n, "remote"));
    if (n.metadata !== undefined) requireThat(plain(n.metadata));
    if (n.visibility !== undefined) {
      keys(n.visibility, ["mode", "readers"]);
      requireThat(
        ["public", "restricted"].includes(n.visibility.mode) &&
          Array.isArray(n.visibility.readers),
      );
      n.visibility.readers.forEach(id);
      unique(n.visibility.readers);
      requireThat(
        n.visibility.mode === "public" || n.visibility.readers.length > 0,
      );
    }
  }
  unique(m.nodes.map((n: Node) => n.id));
  unique(m.nodes.filter((n: Node) => n.remote).map((n: Node) => n.remote!));
  unique(
    m.nodes.map((n: Node) =>
      JSON.stringify([n.parentId, n.slug.toLowerCase()]),
    ),
  );
  const roots = m.nodes.filter((n: Node) => n.parentId === null);
  requireThat(
    roots.length === 1 &&
      ["user", "organization"].includes(roots[0].kind) &&
      roots[0].visibility,
  );
  const byId = new Map<string, Node>(m.nodes.map((n: Node) => [n.id, n]));
  for (const n of m.nodes as Node[]) {
    if (n.parentId !== null) {
      const p = byId.get(n.parentId);
      requireThat(p && kinds[n.kind].includes(p.kind));
    }
    let cursor: Node | undefined = n;
    const seen = new Set();
    while (cursor) {
      requireThat(!seen.has(cursor.id) && seen.size < 32);
      seen.add(cursor.id);
      cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
    }
  }
  let count = 0;
  for (const [list, workflow] of [
    [m.policies, false],
    [m.workflows, true],
  ] as const) {
    requireThat(list.length <= 20000);
    for (const p of list) {
      keys(
        p,
        workflow
          ? ["nodeId", "id", "settings", "constraints", "steps"]
          : ["nodeId", "settings", "constraints"],
      );
      requireThat(byId.has(p.nodeId));
      settings(p.settings);
      constraints(p.constraints);
      count += p.settings.length + p.constraints.length;
      if (workflow) {
        id(p.id);
        requireThat(Array.isArray(p.steps));
        count += p.steps.length;
        for (const s of p.steps) {
          if (Object.hasOwn(s, "remove")) {
            keys(s, ["id", "remove"]);
            requireThat(s.remove === true);
          } else {
            keys(s, ["id", "action", "inputs"]);
            id(s.action);
            requireThat(plain(s.inputs));
          }
          id(s.id);
        }
        unique(p.steps.map((s: Step) => s.id));
      }
    }
    unique(
      list.map((p: any) => JSON.stringify([p.nodeId, workflow ? p.id : null])),
    );
  }
  requireThat(count <= 20000);
  return m as Manifest;
}
export interface Snapshot {
  manifest: Manifest;
  revision: string;
  complete: true;
  stale: false;
  authorization: "advisory" | "enforced";
  coverage: "authority";
  subject: string | null;
}
export function validateSnapshot(input: unknown): Snapshot {
  bounded(input);
  const s: Record<string, any> = structuredClone(input) as Record<string, any>;
  keys(s, [
    "manifest",
    "revision",
    "complete",
    "stale",
    "authorization",
    "coverage",
    "subject",
  ]);
  requireThat(
    s.complete === true && s.stale === false && s.coverage === "authority",
    "INCOMPLETE",
  );
  id(s.revision);
  requireThat(["advisory", "enforced"].includes(s.authorization));
  if (s.authorization === "advisory") requireThat(s.subject === null);
  else id(s.subject);
  s.manifest = validateManifest(s.manifest);
  return s as Snapshot;
}
export function ancestors(manifest: Manifest, nodeId: string): Node[] {
  const m = validateManifest(manifest);
  return ancestryFrom(new Map(m.nodes.map((n) => [n.id, n])), nodeId);
}
function ancestryFrom(map: Map<string, Node>, nodeId: string): Node[] {
  let n = map.get(nodeId);
  requireThat(n, "UNAVAILABLE");
  const out: Node[] = [];
  while (n) {
    out.unshift(n);
    n = n.parentId === null ? undefined : map.get(n.parentId);
  }
  return out;
}
function readable(chain: Node[], principal: string): boolean {
  return chain.every(
    (n) =>
      !n.visibility ||
      n.visibility.mode === "public" ||
      n.visibility.readers.includes(principal),
  );
}
export function canRead(
  manifest: Manifest,
  nodeId: string,
  principal: string,
): boolean {
  id(principal);
  try {
    return ancestors(manifest, nodeId).every(
      (n) =>
        !n.visibility ||
        n.visibility.mode === "public" ||
        n.visibility.readers.includes(principal),
    );
  } catch (e) {
    if (e instanceof GovernanceError && e.code === "UNAVAILABLE") return false;
    throw e;
  }
}
function authorized(snapshot: unknown, principal: string): Snapshot {
  id(principal);
  const s = validateSnapshot(snapshot);
  requireThat(
    s.authorization !== "enforced" || s.subject === principal,
    "UNAVAILABLE",
  );
  return s;
}
export function visibleNodes(
  snapshot: unknown,
  principal: string,
): Pick<Node, "id" | "kind" | "slug" | "parentId">[] {
  const s = authorized(snapshot, principal);
  const map = new Map(s.manifest.nodes.map((n) => [n.id, n]));
  return s.manifest.nodes
    .filter((n) => readable(ancestryFrom(map, n.id), principal))
    .map(({ id, kind, slug, parentId }) => ({ id, kind, slug, parentId }));
}
export interface ResolveOptions {
  workflowId?: string;
  defaults?: Setting[];
  invocation?: Setting[];
}
export type Provenance = Setting & {
  nodeId: string;
  workflowId: string | null;
};
export interface Resolution {
  values: Record<string, Json>;
  provenance: Provenance[];
  constraints: (Constraint & { nodeId: string; workflowId: string | null })[];
  ancestry: string[];
  revision: string;
  authorization: Snapshot["authorization"];
  workflow: { id: string; steps: Step[]; executable: false } | null;
}
function deepMerge(a: Json, b: Json): Json {
  if (plain(a) && plain(b)) {
    const out: Record<string, Json> = { ...(a as Record<string, Json>) };
    const right = b as Record<string, Json>;
    for (const k of Object.keys(right))
      out[k] = Object.hasOwn(out, k)
        ? deepMerge(out[k], right[k])
        : structuredClone(right[k]);
    return out;
  }
  requireThat(
    (a === null && b === null) ||
      (a !== null &&
        b !== null &&
        typeof a === typeof b &&
        Array.isArray(a) === Array.isArray(b) &&
        plain(a) === plain(b)),
  );
  return structuredClone(b);
}
export function resolvePolicy(
  snapshot: unknown,
  nodeId: string,
  principal: string,
  options: ResolveOptions = {},
): Resolution {
  return resolvePolicyBatch(snapshot, [nodeId], principal, options)[0];
}
/** Internal batch boundary: validate/copy once, never cache mutable caller data. */
export function resolvePolicyBatch(
  snapshot: unknown,
  nodeIds: string[],
  principal: string,
  options: ResolveOptions = {},
): Resolution[] {
  const s = authorized(snapshot, principal);
  const map = new Map(s.manifest.nodes.map((n) => [n.id, n]));
  return nodeIds.map((nodeId) =>
    resolveInSnapshot(s, ancestryFrom(map, nodeId), principal, options),
  );
}
function resolveInSnapshot(
  s: Snapshot,
  chain: Node[],
  principal: string,
  options: ResolveOptions,
): Resolution {
  requireThat(readable(chain, principal), "UNAVAILABLE");
  bounded(options);
  keys(options, [], ["workflowId", "defaults", "invocation"]);
  if (options.workflowId !== undefined) id(options.workflowId);
  const r: Resolution = {
    values: {},
    provenance: [],
    constraints: [],
    ancestry: chain.map((n) => n.id),
    revision: s.revision,
    authorization: s.authorization,
    workflow: null,
  };
  const used = new Set<string>();
  const apply = (
    list: Setting[],
    source: string,
    workflowId: string | null,
  ) => {
    settings(list);
    for (const op of list) {
      for (const k of used)
        requireThat(
          k === op.key ||
            (!k.startsWith(op.key + ".") && !op.key.startsWith(k + ".")),
        );
      used.add(op.key);
      const has = Object.hasOwn(r.values, op.key),
        old = r.values[op.key];
      if (op.merge === "remove") {
        requireThat(has);
        delete r.values[op.key];
      } else {
        const v = structuredClone(op.value);
        switch (op.merge) {
          case "replace":
            r.values[op.key] = v;
            break;
          case "deep-merge":
            requireThat(!has || plain(old));
            r.values[op.key] = deepMerge(has ? old : {}, v);
            break;
          case "append":
          case "set-union": {
            requireThat(!has || Array.isArray(old));
            const all = [...(has ? (old as Json[]) : []), ...(v as Json[])];
            r.values[op.key] =
              op.merge === "append"
                ? all
                : all.filter(
                    (e, i) =>
                      all.findIndex(
                        (t) => canonicalJson(t) === canonicalJson(e),
                      ) === i,
                  );
            break;
          }
          case "keyed-merge": {
            requireThat(!has || Array.isArray(old));
            const out: Json[] = structuredClone(has ? (old as Json[]) : []);
            for (const e of out) {
              requireThat(plain(e));
              id((e as Record<string, Json>).id);
            }
            unique(out.map((e: any) => e.id));
            for (const e of v as Record<string, Json>[]) {
              const i = out.findIndex((t: any) => t.id === e.id);
              if (i < 0) out.push(e);
              else out[i] = deepMerge(out[i], e);
            }
            r.values[op.key] = out;
            break;
          }
        }
      }
      r.provenance.push({ ...structuredClone(op), nodeId: source, workflowId });
    }
  };
  apply(options.defaults ?? [], "$defaults", null);
  for (const n of chain) {
    const w =
      options.workflowId === undefined
        ? undefined
        : s.manifest.workflows.find(
            (w) => w.nodeId === n.id && w.id === options.workflowId,
          );
    if (w) {
      r.workflow ??= { id: w.id, steps: [], executable: false };
      apply(w.settings, n.id, w.id);
      r.constraints.push(
        ...w.constraints.map((c) => ({ ...c, nodeId: n.id, workflowId: w.id })),
      );
      for (const step of w.steps) {
        const i = r.workflow.steps.findIndex((s) => s.id === step.id);
        if ("remove" in step) {
          requireThat(i >= 0);
          r.workflow.steps.splice(i, 1);
        } else if (i < 0) r.workflow.steps.push(structuredClone(step));
        else r.workflow.steps[i] = structuredClone(step);
      }
    }
    const p = s.manifest.policies.find((p) => p.nodeId === n.id);
    if (p) {
      apply(p.settings, n.id, null);
      r.constraints.push(
        ...p.constraints.map((c) => ({ ...c, nodeId: n.id, workflowId: null })),
      );
    }
  }
  requireThat(
    options.workflowId === undefined || r.workflow !== null,
    "UNAVAILABLE",
  );
  apply(options.invocation ?? [], "$invocation", null);
  for (const c of r.constraints) {
    used.add(c.key);
    for (const k of used)
      requireThat(
        k === c.key ||
          (!k.startsWith(c.key + ".") && !c.key.startsWith(k + ".")),
      );
    const has = Object.hasOwn(r.values, c.key),
      v = r.values[c.key];
    const eq = (a: Json, b: Json) => canonicalJson(a) === canonicalJson(b);
    requireThat(
      c.operator === "equals"
        ? has && eq(v, c.value)
        : c.operator === "forbidden-values"
          ? !has || !(c.value as Json[]).some((t) => eq(v, t))
          : has &&
            Array.isArray(v) &&
            (c.value as Json[]).every((t) => v.some((e) => eq(e, t))),
      "CONSTRAINT",
    );
  }
  bounded(r);
  return r;
}
