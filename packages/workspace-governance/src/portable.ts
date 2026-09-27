import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { canonicalRemote, requireThat } from "./core.ts";
import type { Json } from "./core.ts";
import { parseDataText, validateCatalogDocument } from "./v2-model.ts";
import type { CatalogDocument } from "./v2-model.ts";
import { assertCatalogRulesResolvable } from "./v2-context.ts";

export const MAX_PORTABLE_BYTES = 2 * 1024 * 1024;
export const PORTABLE_FORMAT = "workspacectl-portable/1" as const;
export const PORTABLE_NOT_CARRIED = Object.freeze([
  "config", "local-state", "checkout-paths", "workspace-ids", "native-project-ids",
  "coordination-bindings", "trusted-roots", "approvals", "plans", "journals", "runs",
  "locks", "observations", "receipts", "cached-state", "executable-fingerprints",
  "credentials", "environment-values",
] as const);

export interface PortableDependant {
  kind: "policy" | "workflow" | "workflow-step";
  id: string;
  field: string;
}
export interface PortableUnresolvedBinding {
  id: string;
  status: "needs-binding";
  sourceKind: "reference" | "source-path" | "workspace" | "coordination" | "executable" | "absolute-argument" | "environment" | "target" | "path" | "review-target";
  provenance: { ownerKind: PortableDependant["kind"]; ownerId: string; field: string };
  dependants: PortableDependant[];
}
export interface PortableDocument {
  schemaVersion: 1;
  format: typeof PORTABLE_FORMAT;
  producer: { name: "workspacectl"; version: string };
  createdAt: string;
  logical: CatalogDocument;
  unresolvedBindings: PortableUnresolvedBinding[];
  notCarried: string[];
  digest: string;
}

const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function exactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []): asserts value is Record<string, any> {
  requireThat(plain(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key)), "INVALID_CONFIG");
}
function noLoneSurrogates(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

/** RFC 8785 / JCS canonical JSON for bounded I-JSON values. */
export function rfc8785Canonicalize(value: unknown): string {
  const render = (item: unknown): string => {
    if (item === null) return "null";
    if (typeof item === "boolean") return item ? "true" : "false";
    if (typeof item === "string") { requireThat(noLoneSurrogates(item), "INVALID_CONFIG"); return JSON.stringify(item); }
    if (typeof item === "number") { requireThat(Number.isFinite(item), "INVALID_CONFIG"); return JSON.stringify(item); }
    if (Array.isArray(item)) return `[${item.map(render).join(",")}]`;
    requireThat(plain(item), "INVALID_CONFIG");
    const keys = Object.keys(item);
    requireThat(keys.length <= 100_000 && keys.every(noLoneSurrogates), "INVALID_CONFIG");
    keys.sort(); // ECMAScript UTF-16 code-unit order required by RFC 8785.
    return `{${keys.map(key => `${JSON.stringify(key)}:${render(item[key])}`).join(",")}}`;
  };
  const canonical = render(value);
  requireThat(Buffer.byteLength(canonical, "utf8") <= MAX_PORTABLE_BYTES, "INVALID_CONFIG");
  return canonical;
}
function portableDigest(value: Omit<PortableDocument, "digest">): string {
  return `sha256:${createHash("sha256").update(rfc8785Canonicalize(value), "utf8").digest("hex")}`;
}

function ownerId(record: { scope: { kind: string; id: string }; id?: string }): string {
  return record.id === undefined ? `${record.scope.kind}:${record.scope.id}` : `${record.scope.kind}:${record.scope.id}:${record.id}`;
}

function transformCatalog(input: CatalogDocument): { logical: CatalogDocument; bindings: PortableUnresolvedBinding[] } {
  const logical = structuredClone(validateCatalogDocument(input));
  const repositoryIds = new Set(logical.repositories.map(repository => repository.id));
  const repositoryAliases = new Set(logical.repositories.flatMap(repository => repository.aliases.map(alias => alias.toLowerCase())));
  const repositoryRemotes = new Set(logical.repositories.map(repository => canonicalRemote(repository.remote)));
  const bindings: PortableUnresolvedBinding[] = [];
  const bind = (sourceKind: PortableUnresolvedBinding["sourceKind"], dependant: PortableDependant): string => {
    const id = `binding-${createHash("sha256").update(`${sourceKind}\0${dependant.kind}\0${dependant.id}\0${dependant.field}`).digest("hex").slice(0, 24)}`;
    requireThat(!bindings.some(item => item.id === id), "INVALID_CONFIG");
    bindings.push({ id, status: "needs-binding", sourceKind, provenance: { ownerKind: dependant.kind, ownerId: dependant.id, field: dependant.field }, dependants: [structuredClone(dependant)] });
    return `needs-binding:${id}`;
  };
  const closeProvenance = (provenance: Record<string, any>): void => {
    const source = provenance.sourceRepository;
    requireThat(typeof source === "string", "INVALID_CONFIG");
    if (repositoryIds.has(source) || repositoryAliases.has(source.toLowerCase())) return;
    let remote: string;
    try { remote = canonicalRemote(source); } catch { requireThat(false, "INVALID_CONFIG"); }
    requireThat(repositoryRemotes.has(remote!), "INVALID_CONFIG");
  };
  const scopeKey = (scope: { kind: string; id: string }): string => `${scope.kind}\0${scope.id}`;
  const groups = new Map(logical.groups.map(group => [group.id, group]));
  const workflowByScope = new Map(logical.workflows.map(workflow => [`${workflow.id}\0${scopeKey(workflow.scope)}`, workflow]));
  const groupChain = (id: string): Array<{ kind: string; id: string }> => {
    const chain: Array<{ kind: string; id: string }> = [];
    const seen = new Set<string>();
    let current = groups.get(id);
    while (current !== undefined) {
      requireThat(!seen.has(current.id), "INVALID_CONFIG");
      seen.add(current.id); chain.unshift({ kind: current.kind, id: current.id });
      current = current.parentId === null ? undefined : groups.get(current.parentId);
    }
    return chain;
  };
  const effectiveOutputIds = (workflow: CatalogDocument["workflows"][number]): Set<string> => {
    const common = [{ kind: "base", id: "defaults" }, { kind: "user", id: "user" }];
    let chains: Array<Array<{ kind: string; id: string }>>;
    if (["organization", "area", "project"].includes(workflow.scope.kind)) {
      chains = [[...common, ...groupChain(workflow.scope.id)]];
    } else if (workflow.scope.kind === "repository") {
      const repository = logical.repositories.find(item => item.id === workflow.scope.id)!;
      const groupIds = [repository.primaryGroupId, ...repository.memberOf.filter(id => groups.get(id)?.kind === "project")]
        .filter((id): id is string => id !== null);
      const uniqueGroupIds = [...new Set(groupIds)];
      chains = (uniqueGroupIds.length === 0 ? [[...common]] : uniqueGroupIds.map(id => [...common, ...groupChain(id)]))
        .map(chain => [...chain, workflow.scope]);
    } else if (workflow.scope.kind === "user") {
      chains = [[{ kind: "base", id: "defaults" }, workflow.scope]];
    } else {
      chains = [[workflow.scope]];
    }
    const sets = chains.map(chain => {
      let outputs: CatalogDocument["workflows"][number]["outputs"] = [];
      for (const scope of chain) {
        const record = workflowByScope.get(`${workflow.id}\0${scopeKey(scope)}`);
        if (record !== undefined && record.outputs.length > 0) {
          requireThat(outputs.length === 0 || rfc8785Canonicalize(outputs) === rfc8785Canonicalize(record.outputs), "INVALID_CONFIG");
          outputs = record.outputs;
        }
      }
      return new Set(outputs.map(output => output.id));
    });
    const [first = new Set<string>(), ...rest] = sets;
    return new Set([...first].filter(id => rest.every(set => set.has(id))));
  };
  for (const policy of logical.policies) {
    const id = ownerId(policy);
    for (const section of ["knowledge", "skills"] as const) policy[section] = policy[section].map((record, index) => Object.hasOwn(record, "remove") ? record : ({ ...record, reference: bind("reference", { kind: "policy", id, field: `${section}.${index}.reference` }) }));
    if (policy.provenance) {
      closeProvenance(policy.provenance);
      policy.provenance.sourcePath = bind("source-path", { kind: "policy", id, field: "provenance.sourcePath" });
    }
  }
  const replace = (value: Record<string, any>, key: string, sourceKind: PortableUnresolvedBinding["sourceKind"], dependant: PortableDependant) => { value[key] = bind(sourceKind, dependant); };
  for (const workflow of logical.workflows) {
    const workflowId = ownerId(workflow);
    if (workflow.provenance) {
      closeProvenance(workflow.provenance);
      workflow.provenance.sourcePath = bind("source-path", { kind: "workflow", id: workflowId, field: "provenance.sourcePath" });
    }
    const outputIds = effectiveOutputIds(workflow);
    const outputReference = (value: unknown): void => requireThat(typeof value === "string" && outputIds.has(value), "INVALID_CONFIG");
    const steps = workflow.steps.filter(step => !Object.hasOwn(step, "remove")) as Array<any>;

    for (const step of steps) {
      const dependant = (field: string): PortableDependant => ({ kind: "workflow-step", id: `${workflowId}:${step.id}`, field: `configuration.${field}` });
      const c = step.configuration as Record<string, any>;
      const allowed: Record<string, readonly string[]> = {
        "coordination.check": ["coordinationWorkspaceId", "memberWorkspaceIds"],
        "context.resolve": ["repositoryId", "workspaceId"], "workspace.check": ["repositoryId", "workspaceId"],
        "agent.task": ["target", "objective", "expectedOutputs", "verification", "repositoryId", "workspaceId"],
        "external.action": ["target", "objective", "expectedOutputs", "verification", "repositoryId", "workspaceId"],
        command: ["executable", "argv", "inputFiles", "cwd", "environment", "timeoutMs", "expectedExit", "repositoryId", "workspaceId"],
        verify: ["checks", "repositoryId", "workspaceId"],
        "rules.distribute": ["outputId", "source", "repositories"],
      };
      requireThat(Object.hasOwn(allowed, step.type), "UNSUPPORTED");
      requireThat(Object.keys(c).every(key => allowed[step.type].includes(key)), "UNSUPPORTED");
      if (Object.hasOwn(c, "repositoryId")) requireThat(typeof c.repositoryId === "string" && repositoryIds.has(c.repositoryId), "INVALID_CONFIG");
      if (Object.hasOwn(c, "workspaceId")) replace(c, "workspaceId", "workspace", dependant("workspaceId"));
      if (step.type === "coordination.check") {
        replace(c, "coordinationWorkspaceId", "coordination", dependant("coordinationWorkspaceId"));
        requireThat(Array.isArray(c.memberWorkspaceIds), "INVALID_CONFIG");
        c.memberWorkspaceIds = c.memberWorkspaceIds.map((_value: unknown, index: number) => bind("workspace", dependant(`memberWorkspaceIds.${index}`)));
      }
      if (step.type === "agent.task" || step.type === "external.action") replace(c, "target", "target", dependant("target"));
      if (step.type === "command") {
        replace(c, "executable", "executable", dependant("executable"));
        requireThat(Array.isArray(c.argv) && Array.isArray(c.environment), "INVALID_CONFIG");
        c.argv = c.argv.map((entry: unknown, index: number) => typeof entry === "string" && (isAbsolute(entry) || entry.startsWith("needs-binding:")) ? bind("absolute-argument", dependant(`argv.${index}`)) : entry);
        if (Object.hasOwn(c, "inputFiles")) {
          requireThat(Array.isArray(c.inputFiles) && c.inputFiles.length <= c.argv.length, "INVALID_CONFIG");
          const indexes = new Set<number>();
          for (const rawEntry of c.inputFiles) {
            const entry = rawEntry as any, argvIndex = entry?.argvIndex;
            requireThat(plain(entry) && Object.keys(entry).length === 1 && Number.isInteger(argvIndex) && argvIndex >= 0 && argvIndex < c.argv.length && !indexes.has(argvIndex), "INVALID_CONFIG");
            const argument = c.argv[argvIndex];
            requireThat(typeof argument === "string" && (isAbsolute(argument) || argument.startsWith("needs-binding:")), "INVALID_CONFIG");
            indexes.add(argvIndex);
          }
        }
        replace(c, "cwd", "workspace", dependant("cwd"));
        c.environment = c.environment.map((_entry: unknown, index: number) => bind("environment", dependant(`environment.${index}`)));
      }
      const transformChecks = (checks: any[], prefix: string, idsRequired: boolean) => {
        requireThat(Array.isArray(checks), "INVALID_CONFIG");
        const seenIds = new Set<string>();
        for (let index = 0; index < checks.length; index += 1) {
          requireThat(plain(checks[index]), "INVALID_CONFIG");
          replace(checks[index], "path", "path", dependant(`${prefix}.${index}.path`));
          if (idsRequired) {
            outputReference(checks[index].id);
            requireThat(!seenIds.has(checks[index].id), "INVALID_CONFIG");
            seenIds.add(checks[index].id);
          } else if (Object.hasOwn(checks[index], "outputId")) outputReference(checks[index].outputId);
        }
      };
      if (step.type === "agent.task" || step.type === "external.action") { transformChecks(c.expectedOutputs, "expectedOutputs", true); transformChecks(c.verification, "verification", false); }
      if (step.type === "verify") transformChecks(c.checks, "checks", false);
      if (step.type === "rules.distribute") {
        outputReference(c.outputId);
        requireThat(plain(c.source) && Array.isArray(c.repositories), "INVALID_CONFIG"); replace(c.source, "path", "source-path", dependant("source.path"));
        requireThat(typeof c.source.repositoryId === "string" && repositoryIds.has(c.source.repositoryId), "INVALID_CONFIG");
        for (let index = 0; index < c.repositories.length; index += 1) { const item = c.repositories[index]; requireThat(plain(item) && typeof item.repositoryId === "string" && repositoryIds.has(item.repositoryId), "INVALID_CONFIG"); replace(item, "workspaceId", "workspace", dependant(`repositories.${index}.workspaceId`)); if (item.status === "carrying") { replace(item, "carryingPath", "path", dependant(`repositories.${index}.carryingPath`)); replace(item, "reviewTarget", "review-target", dependant(`repositories.${index}.reviewTarget`)); } }
      }
    }
  }
  const validated = validateCatalogDocument(logical);
  assertCatalogRulesResolvable(validated);
  return { logical: validated, bindings };
}

function assertAliasClosure(catalog: CatalogDocument): void {
  const identities = new Map<string, string>();
  for (const repository of catalog.repositories) {
    const values = [repository.id, canonicalRemote(repository.remote), ...repository.aliases.map(alias => alias.toLowerCase())];
    for (const value of values) { const key = value.toLowerCase(); const prior = identities.get(key); requireThat(prior === undefined || prior === repository.id, "INVALID_CONFIG"); identities.set(key, repository.id); }
  }
}

export function createPortableDocument(catalog: CatalogDocument, createdAt = new Date().toISOString(), producerVersion = "0.3.0-dev"): PortableDocument {
  requireThat(new Date(createdAt).toISOString() === createdAt && producerVersion.length > 0 && producerVersion.length <= 128, "INVALID_CONFIG");
  assertAliasClosure(catalog);
  const { logical, bindings } = transformCatalog(catalog);
  const base: Omit<PortableDocument, "digest"> = { schemaVersion: 1, format: PORTABLE_FORMAT, producer: { name: "workspacectl", version: producerVersion }, createdAt, logical, unresolvedBindings: bindings, notCarried: [...PORTABLE_NOT_CARRIED] };
  const document = { ...base, digest: portableDigest(base) };
  requireThat(Buffer.byteLength(JSON.stringify(document), "utf8") <= MAX_PORTABLE_BYTES, "INVALID_CONFIG");
  return validatePortableDocument(document);
}

export function validatePortableDocument(input: unknown): PortableDocument {
  exactKeys(input, ["schemaVersion", "format", "producer", "createdAt", "logical", "unresolvedBindings", "notCarried", "digest"]);
  requireThat(input.schemaVersion === 1 && input.format === PORTABLE_FORMAT, "INVALID_CONFIG");
  exactKeys(input.producer, ["name", "version"]); requireThat(input.producer.name === "workspacectl" && typeof input.producer.version === "string" && input.producer.version.length > 0 && input.producer.version.length <= 128, "INVALID_CONFIG");
  requireThat(typeof input.createdAt === "string" && new Date(input.createdAt).toISOString() === input.createdAt, "INVALID_CONFIG");
  requireThat(Array.isArray(input.notCarried) && JSON.stringify(input.notCarried) === JSON.stringify(PORTABLE_NOT_CARRIED), "INVALID_CONFIG");
  requireThat(Array.isArray(input.unresolvedBindings) && input.unresolvedBindings.length <= 100_000, "INVALID_CONFIG");
  const catalog = validateCatalogDocument(input.logical); assertAliasClosure(catalog);
  const classified = transformCatalog(catalog);
  requireThat(
    rfc8785Canonicalize(classified.logical) === rfc8785Canonicalize(catalog) &&
      rfc8785Canonicalize(classified.bindings) === rfc8785Canonicalize(input.unresolvedBindings),
    "INVALID_CONFIG",
  );
  const markerDependants = new Map<string, PortableDependant[]>();
  const scan = (value: unknown, path: string, owner: PortableDependant["kind"], id: string) => { if (typeof value === "string" && value.startsWith("needs-binding:")) { const bindingId = value.slice(14); const dependant = { kind: owner, id, field: path }; (markerDependants.get(bindingId) ?? markerDependants.set(bindingId, []).get(bindingId)!).push(dependant); } else if (Array.isArray(value)) value.forEach((item, index) => scan(item, `${path}.${index}`, owner, id)); else if (plain(value)) for (const [key, item] of Object.entries(value)) scan(item, path ? `${path}.${key}` : key, owner, id); };
  for (const policy of catalog.policies) scan(policy, "", "policy", ownerId(policy));
  for (const workflow of catalog.workflows) {
    const wid = ownerId(workflow);
    if (workflow.provenance) {
      scan(workflow.provenance.sourceRepository, "provenance.sourceRepository", "workflow", wid);
      scan(workflow.provenance.sourcePath, "provenance.sourcePath", "workflow", wid);
    }
    for (const step of workflow.steps) {
      if ("remove" in step) continue;
      scan(step.configuration, "configuration", "workflow-step", `${wid}:${step.id}`);
    }
  }
  const seen = new Set<string>();
  for (const binding of input.unresolvedBindings) {
    exactKeys(binding, ["id", "status", "sourceKind", "provenance", "dependants"]); requireThat(typeof binding.id === "string" && /^binding-[a-f0-9]{24}$/.test(binding.id) && !seen.has(binding.id), "INVALID_CONFIG"); seen.add(binding.id);
    requireThat(binding.status === "needs-binding" && ["reference", "source-path", "workspace", "coordination", "executable", "absolute-argument", "environment", "target", "path", "review-target"].includes(binding.sourceKind), "INVALID_CONFIG");
    exactKeys(binding.provenance, ["ownerKind", "ownerId", "field"]); requireThat(Array.isArray(binding.dependants) && binding.dependants.length === 1, "INVALID_CONFIG");
    const expected = markerDependants.get(binding.id);
    requireThat(
      expected?.length === 1 &&
        rfc8785Canonicalize(expected[0]) === rfc8785Canonicalize(binding.dependants[0]) &&
        rfc8785Canonicalize(binding.provenance) === rfc8785Canonicalize({
          ownerKind: expected[0].kind,
          ownerId: expected[0].id,
          field: expected[0].field,
        }),
      "INVALID_CONFIG",
    );
  }
  requireThat(seen.size === markerDependants.size, "INVALID_CONFIG");
  const clone = structuredClone(input) as Record<string, unknown>; const supplied = clone.digest; delete clone.digest;
  requireThat(typeof supplied === "string" && /^sha256:[a-f0-9]{64}$/.test(supplied) && portableDigest(clone as unknown as Omit<PortableDocument, "digest">) === supplied, "INVALID_CONFIG");
  return structuredClone(input) as PortableDocument;
}

export function parsePortableText(text: string): PortableDocument {
  requireThat(typeof text === "string" && Buffer.byteLength(text, "utf8") <= MAX_PORTABLE_BYTES, "INVALID_CONFIG");
  return validatePortableDocument(parseDataText(text, "json", MAX_PORTABLE_BYTES));
}
export function portableCatalog(document: PortableDocument): CatalogDocument { return structuredClone(validatePortableDocument(document).logical); }
