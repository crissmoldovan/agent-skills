import { GovernanceError, resolvePolicy, requireThat } from "./core.ts";
import type { Constraint, Json, Manifest, Setting } from "./core.ts";
import { emptyLocalStateDocument, validateCatalogDocument, validateLocalStateDocument } from "./v2-model.ts";
import type { CatalogDocument, GroupRecord, LocalStateDocument } from "./v2-model.ts";
import { validatePolicyRecord } from "./v2-rules.ts";
import type {
  ExternalRuleSetProvenance,
  InstructionRecord,
  PolicyRecord,
  PolicyScope,
  ReferenceRecord,
  WorkflowRecord,
  WorkflowStep,
} from "./v2-rules.ts";

export interface InvocationPolicy {
  settings: Record<string, Json>;
  operations: Setting[];
  constraints?: Constraint[];
  instructions?: InstructionRecord[];
  knowledge?: ReferenceRecord[];
  skills?: ReferenceRecord[];
}
export interface ResolveCatalogRequest {
  repositoryId: string;
  workspaceId?: string;
  selectedProjectId?: string;
  workflowId?: string;
  userPolicies?: PolicyRecord[];
  invocation?: InvocationPolicy;
}
export interface ResolvedNamedRecord {
  id: string;
  required: boolean;
  scope: PolicyScope;
  workflowId: string | null;
  provenance?: ExternalRuleSetProvenance;
  text?: string;
  reference?: string;
}
export interface ContextProvenance {
  key: string;
  merge: string;
  value?: Json;
  scope: PolicyScope;
  workflowId: string | null;
  provenance?: ExternalRuleSetProvenance;
}
export interface NamedRecordProvenance {
  category: "instruction" | "knowledge" | "skill";
  recordId: string;
  operation: "add" | "replace" | "remove";
  scope: PolicyScope;
  workflowId: string | null;
  provenance?: ExternalRuleSetProvenance;
}
export interface ResolvedCatalogContext {
  schemaVersion: 2;
  repositoryId: string;
  workspaceId: string | null;
  selectedProjectId: string | null;
  revisions: { catalog: string; localState: string };
  settings: Record<string, Json>;
  provenance: ContextProvenance[];
  constraints: Array<Constraint & { scope: PolicyScope; workflowId: string | null; provenance?: ExternalRuleSetProvenance }>;
  instructions: ResolvedNamedRecord[];
  knowledgeReferences: ResolvedNamedRecord[];
  selectedSkills: ResolvedNamedRecord[];
  recordProvenance: NamedRecordProvenance[];
  workflow: { id: string; inputs: WorkflowRecord["inputs"]; outputs: WorkflowRecord["outputs"]; steps: Exclude<WorkflowStep, { remove: true }>[]; provenance: Array<{ stepId: string; operation: "add" | "replace" | "remove"; scope: PolicyScope; provenance?: ExternalRuleSetProvenance }>; executable: false } | null;
  ancestry: string[];
  warnings: string[];
}

function conflict(reason: string, details: Record<string, Json> = {}): never {
  throw new GovernanceError("POLICY_CONFLICT", { reason, ...details });
}
function groupChain(groups: Map<string, GroupRecord>, groupId: string): GroupRecord[] {
  const result: GroupRecord[] = [];
  let current = groups.get(groupId);
  if (!current) conflict("unknown-group", { groupId });
  while (current) {
    result.unshift(current);
    current = current.parentId === null ? undefined : groups.get(current.parentId);
    if (result.length > 32) conflict("invalid-ancestry", { groupId });
  }
  if (result[0]?.kind !== "organization") conflict("invalid-ancestry", { groupId });
  return result;
}
function policySettings(record: { settings: Record<string, Json>; operations: Setting[] }): Setting[] {
  return [
    ...Object.entries(record.settings).map(([key, value]) => ({ key, merge: "replace" as const, value })),
    ...record.operations,
  ];
}
function mergeNamed<T extends InstructionRecord | ReferenceRecord>(
  destination: ResolvedNamedRecord[], records: T[], scope: PolicyScope, workflowId: string | null,
  category: NamedRecordProvenance["category"], events: NamedRecordProvenance[], provenance?: ExternalRuleSetProvenance,
): void {
  for (const record of records) {
    const index = destination.findIndex((candidate) => candidate.id === record.id);
    if ("remove" in record) {
      if (index < 0) conflict("unknown-removal", { recordId: record.id, scope: scope.id });
      if (destination[index].required) conflict("required-removal", { recordId: record.id, scope: scope.id });
      destination.splice(index, 1);
      events.push({ category, recordId: record.id, operation: "remove", scope: structuredClone(scope), workflowId, ...(provenance ? { provenance: structuredClone(provenance) } : {}) });
      continue;
    }
    const resolved: ResolvedNamedRecord = {
      id: record.id,
      required: record.required || (index >= 0 && destination[index].required),
      ...(Object.hasOwn(record, "text") ? { text: (record as { text: string }).text } : { reference: (record as { reference: string }).reference }),
      scope: structuredClone(scope), workflowId,
      ...(provenance === undefined ? {} : { provenance: structuredClone(provenance) }),
    };
    events.push({ category, recordId: record.id, operation: index < 0 ? "add" : "replace", scope: structuredClone(scope), workflowId, ...(provenance ? { provenance: structuredClone(provenance) } : {}) });
    if (index < 0) destination.push(resolved); else destination[index] = resolved;
  }
}
function mergeWorkflow(records: WorkflowRecord[]): ResolvedCatalogContext["workflow"] {
  if (records.length === 0) return null;
  let inputs: WorkflowRecord["inputs"] = [];
  let outputs: WorkflowRecord["outputs"] = [];
  const steps: Exclude<WorkflowStep, { remove: true }>[] = [];
  const provenance: NonNullable<ResolvedCatalogContext["workflow"]>["provenance"] = [];
  for (const record of records) {
    if (record.inputs.length > 0) {
      if (inputs.length > 0 && JSON.stringify(inputs) !== JSON.stringify(record.inputs)) conflict("incompatible-workflow-inputs", { workflowId: record.id, scope: record.scope.id });
      inputs = structuredClone(record.inputs);
    }
    if (record.outputs.length > 0) {
      if (outputs.length > 0 && JSON.stringify(outputs) !== JSON.stringify(record.outputs)) conflict("incompatible-workflow-outputs", { workflowId: record.id, scope: record.scope.id });
      outputs = structuredClone(record.outputs);
    }
    for (const step of record.steps) {
      const index = steps.findIndex((candidate) => candidate.id === step.id);
      if ("remove" in step) {
        if (index < 0) conflict("unknown-step-removal", { workflowId: record.id, stepId: step.id });
        if (steps[index].required) conflict("required-step-removal", { workflowId: record.id, stepId: step.id });
        steps.splice(index, 1);
        provenance.push({ stepId: step.id, operation: "remove", scope: structuredClone(record.scope), ...(record.provenance ? { provenance: structuredClone(record.provenance) } : {}) });
      } else if (index < 0) {
        steps.push(structuredClone(step));
        provenance.push({ stepId: step.id, operation: "add", scope: structuredClone(record.scope), ...(record.provenance ? { provenance: structuredClone(record.provenance) } : {}) });
      } else {
        steps[index] = { ...structuredClone(step), required: step.required || steps[index].required };
        provenance.push({ stepId: step.id, operation: "replace", scope: structuredClone(record.scope), ...(record.provenance ? { provenance: structuredClone(record.provenance) } : {}) });
      }
    }
  }
  const ids = new Set(steps.map((step) => step.id));
  for (const step of steps) for (const dependency of step.needs)
    if (!ids.has(dependency)) conflict("missing-workflow-dependency", { stepId: step.id, dependency });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(steps.map((step) => [step.id, step]));
  const visit = (id: string): void => {
    if (visiting.has(id)) conflict("workflow-cycle", { stepId: id });
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)!.needs) visit(dependency);
    visiting.delete(id); visited.add(id);
  };
  for (const id of ids) visit(id);
  return { id: records[0].id, inputs, outputs, steps, provenance, executable: false };
}

export function resolveCatalogContext(catalogInput: unknown, stateInput: unknown, request: ResolveCatalogRequest): ResolvedCatalogContext {
  const catalog = validateCatalogDocument(catalogInput);
  const state = validateLocalStateDocument(stateInput);
  requireThat(request && typeof request === "object" && typeof request.repositoryId === "string", "INVALID_CONFIG");
  const repository = catalog.repositories.find((candidate) => candidate.id === request.repositoryId);
  if (!repository) throw new GovernanceError("NOT_FOUND");
  const groups = new Map(catalog.groups.map((group) => [group.id, group]));
  let selectedGroups: GroupRecord[] = [];
  if (request.selectedProjectId !== undefined) {
    const project = groups.get(request.selectedProjectId);
    const legal = project?.kind === "project" && repository.classification === "confirmed" &&
      (repository.primaryGroupId === project.id || repository.memberOf.includes(project.id));
    if (!legal) conflict("illegal-project-selection", { repositoryId: repository.id, projectId: request.selectedProjectId });
    selectedGroups = groupChain(groups, project.id);
  } else if (repository.classification === "confirmed" && repository.primaryGroupId !== null) selectedGroups = groupChain(groups, repository.primaryGroupId);
  const workspace = request.workspaceId === undefined ? undefined : state.repositoryWorkspaces.find((candidate) => candidate.id === request.workspaceId && candidate.repositoryId === repository.id);
  if (request.workspaceId !== undefined && !workspace) conflict("illegal-workspace-selection", { repositoryId: repository.id, workspaceId: request.workspaceId });

  const requestedScopes: PolicyScope[] = [
    { kind: "base", id: "defaults" }, { kind: "user", id: "user" },
    ...selectedGroups.map((group) => ({ kind: group.kind as "organization" | "area" | "project", id: group.id })),
    { kind: "repository", id: repository.id },
    ...(workspace ? [{ kind: "workspace" as const, id: workspace.id }] : []),
  ];
  const userPolicies = (request.userPolicies ?? []).map(validatePolicyRecord);
  requireThat(userPolicies.every((record) => record.scope.kind === "user"), "INVALID_CONFIG");
  const allPolicies = [...catalog.policies, ...userPolicies, ...state.workspacePolicyOverlays];
  const layers = requestedScopes.map((scope) => ({
    scope,
    policy: allPolicies.find((record) => record.scope.kind === scope.kind && (["base", "user"].includes(scope.kind) || record.scope.id === scope.id)),
    workflow: request.workflowId === undefined ? undefined : [...catalog.workflows, ...(state.workspaceWorkflowOverlays ?? [])].find((record) => record.id === request.workflowId && record.scope.kind === scope.kind && (["base", "user"].includes(scope.kind) || record.scope.id === scope.id)),
  }));
  const workflowRecords = layers.flatMap((layer) => layer.workflow ? [layer.workflow] : []);
  if (request.workflowId !== undefined && workflowRecords.length === 0) throw new GovernanceError("NOT_FOUND");

  const synthetic: Manifest = {
    apiVersion: "workspace-governance/v1", authorityId: "layer-0",
    nodes: layers.map((_, index) => ({
      id: `layer-${index}`, kind: index === 0 ? "user" : index === 1 ? "organization" : "area", slug: `layer-${index}`,
      parentId: index === 0 ? null : `layer-${index - 1}`,
      ...(index === 0 ? { visibility: { mode: "public" as const, readers: [] } } : {}),
    })),
    policies: layers.flatMap((layer, index) => layer.policy ? [{ nodeId: `layer-${index}`, settings: policySettings(layer.policy), constraints: layer.policy.constraints }] : []),
    workflows: layers.flatMap((layer, index) => layer.workflow ? [{ nodeId: `layer-${index}`, id: layer.workflow.id, settings: policySettings(layer.workflow), constraints: layer.workflow.constraints, steps: [] }] : []),
    metadata: {},
  };
  let syntheticTarget = `layer-${layers.length - 1}`;
  if (request.invocation?.constraints?.length) {
    synthetic.nodes.push({ id: "layer-invocation", kind: "area", slug: "layer-invocation", parentId: syntheticTarget });
    synthetic.policies.push({ nodeId: "layer-invocation", settings: [], constraints: request.invocation.constraints });
    syntheticTarget = "layer-invocation";
  }
  let legacy;
  try {
    legacy = resolvePolicy({ manifest: synthetic, revision: "v2", complete: true, stale: false, authorization: "advisory", coverage: "authority", subject: null }, syntheticTarget, "reader", {
      ...(request.workflowId === undefined ? {} : { workflowId: request.workflowId }),
      invocation: request.invocation ? policySettings(request.invocation) : [],
    });
  } catch (error) {
    if (error instanceof GovernanceError) conflict(error.code === "CONSTRAINT" ? "mandatory-constraint" : "setting-merge", { code: error.code });
    throw error;
  }
  const instructions: ResolvedNamedRecord[] = [], knowledgeReferences: ResolvedNamedRecord[] = [], selectedSkills: ResolvedNamedRecord[] = [], recordProvenance: NamedRecordProvenance[] = [];
  for (const layer of layers) if (layer.policy) {
    mergeNamed(instructions, layer.policy.instructions, layer.scope, null, "instruction", recordProvenance, layer.policy.provenance);
    mergeNamed(knowledgeReferences, layer.policy.knowledge, layer.scope, null, "knowledge", recordProvenance, layer.policy.provenance);
    mergeNamed(selectedSkills, layer.policy.skills, layer.scope, null, "skill", recordProvenance, layer.policy.provenance);
  }
  if (request.invocation) {
    const invocationScope: PolicyScope = { kind: "user", id: "$invocation" };
    mergeNamed(instructions, request.invocation.instructions ?? [], invocationScope, null, "instruction", recordProvenance);
    mergeNamed(knowledgeReferences, request.invocation.knowledge ?? [], invocationScope, null, "knowledge", recordProvenance);
    mergeNamed(selectedSkills, request.invocation.skills ?? [], invocationScope, null, "skill", recordProvenance);
  }
  const mapSource = (nodeId: string) => layers[Number(nodeId.slice(6))];
  return {
    schemaVersion: 2, repositoryId: repository.id, workspaceId: workspace?.id ?? null,
    selectedProjectId: request.selectedProjectId ?? null,
    revisions: { catalog: "unbound", localState: "unbound" }, settings: legacy.values,
    provenance: legacy.provenance.map((entry) => {
      if (entry.nodeId === "$invocation") return { ...entry, scope: { kind: "user", id: "$invocation" }, provenance: undefined } as ContextProvenance;
      const layer = mapSource(entry.nodeId); const source = entry.workflowId ? layer.workflow : layer.policy;
      const { nodeId: _nodeId, ...rest } = entry;
      return { ...rest, scope: structuredClone(layer.scope), ...(source?.provenance ? { provenance: structuredClone(source.provenance) } : {}) };
    }),
    constraints: legacy.constraints.map((entry) => {
      if (entry.nodeId === "layer-invocation") {
        const { nodeId: _nodeId, ...rest } = entry;
        return { ...rest, scope: { kind: "user" as const, id: "$invocation" } };
      }
      const layer = mapSource(entry.nodeId); const source = entry.workflowId ? layer.workflow : layer.policy;
      const { nodeId: _nodeId, ...rest } = entry;
      return { ...rest, scope: structuredClone(layer.scope), ...(source?.provenance ? { provenance: structuredClone(source.provenance) } : {}) };
    }),
    instructions, knowledgeReferences, selectedSkills, recordProvenance, workflow: mergeWorkflow(workflowRecords),
    ancestry: [...selectedGroups.map((group) => group.id), repository.id, ...(workspace ? [workspace.id] : [])], warnings: [],
  };
}

export function assertWorkspaceRulesResolvable(catalogInput: unknown, stateInput: unknown, workspaceId: string): void {
  const catalog = validateCatalogDocument(catalogInput);
  const state = validateLocalStateDocument(stateInput);
  const workspace = state.repositoryWorkspaces.find((candidate) => candidate.id === workspaceId);
  if (!workspace) throw new GovernanceError("NOT_FOUND");
  const request = { repositoryId: workspace.repositoryId, workspaceId };
  resolveCatalogContext(catalog, state, request);
  const workflowIds = [...new Set([
    ...catalog.workflows.map((workflow) => workflow.id),
    ...(state.workspaceWorkflowOverlays ?? []).map((workflow) => workflow.id),
  ])];
  for (const workflowId of workflowIds) {
    try { resolveCatalogContext(catalog, state, { ...request, workflowId }); }
    catch (error) {
      if (error instanceof GovernanceError && error.code === "NOT_FOUND") continue;
      throw error;
    }
  }
}

/** Validate every selectable catalog ancestry without activating rule payloads. */
export function assertCatalogRulesResolvable(catalogInput: unknown): void {
  const catalog = validateCatalogDocument(catalogInput);
  const state = emptyLocalStateDocument("/workspacectl/a07-validation-config.json", `sha256:${"0".repeat(64)}`);
  const workflowIds = [...new Set(catalog.workflows.map((workflow) => workflow.id))];
  const syntheticRepositories = catalog.repositories.length > 0 ? catalog.repositories : [
    { id: "$validation-repository", remote: "https://github.com/workspacectl/a07-validation", sourceId: null, primaryGroupId: null, memberOf: [], aliases: [], classification: "confirmed" as const, metadata: {} },
    ...catalog.groups.map((group, index) => ({ id: `$validation-${index}`, remote: `https://github.com/workspacectl/a07-validation-${index}`, sourceId: null, primaryGroupId: group.id, memberOf: [], aliases: [], classification: "confirmed" as const, metadata: {} })),
  ];
  const validationCatalog = catalog.repositories.length > 0 ? catalog : { ...catalog, repositories: syntheticRepositories };
  for (const repository of syntheticRepositories) {
    const primary = catalog.groups.find((group) => group.id === repository.primaryGroupId);
    const projects = repository.classification === "confirmed" ? [
      ...(primary?.kind === "project" ? [primary.id] : []),
      ...repository.memberOf,
    ] : [];
    const selections: Array<string | undefined> = [undefined, ...projects.filter((project, index) => projects.indexOf(project) === index)];
    for (const selectedProjectId of selections) {
      const base = { repositoryId: repository.id, ...(selectedProjectId ? { selectedProjectId } : {}) };
      resolveCatalogContext(validationCatalog, state, base);
      for (const workflowId of workflowIds) {
        try { resolveCatalogContext(validationCatalog, state, { ...base, workflowId }); }
        catch (error) {
          if (error instanceof GovernanceError && error.code === "NOT_FOUND") continue;
          throw error;
        }
      }
    }
  }
}
