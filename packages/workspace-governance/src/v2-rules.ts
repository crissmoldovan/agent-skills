import { createHash } from "node:crypto";
import { canonicalJson, GovernanceError, requireThat } from "./core.ts";
import type { Constraint, Json, Setting } from "./core.ts";

export type PolicyScopeKind = "base" | "user" | "organization" | "area" | "project" | "repository" | "workspace";
export interface PolicyScope { kind: PolicyScopeKind; id: string }
export interface ExternalRuleSetProvenance {
  sourceRepository: string;
  sourcePath: string;
  sourceRevision: string;
  contentDigest: string;
  declaredScope: PolicyScope;
}
export type InstructionRecord =
  | { id: string; text: string; required: boolean }
  | { id: string; remove: true };
export type ReferenceRecord =
  | { id: string; reference: string; required: boolean }
  | { id: string; remove: true };
export interface PolicyRecord {
  scope: PolicyScope;
  settings: Record<string, Json>;
  operations: Setting[];
  constraints: Constraint[];
  instructions: InstructionRecord[];
  knowledge: ReferenceRecord[];
  skills: ReferenceRecord[];
  provenance?: ExternalRuleSetProvenance;
}
export type WorkflowStep =
  | {
      id: string;
      type: string;
      needs: string[];
      configuration: Record<string, Json>;
      sideEffect: "none" | "workspace" | "external" | "destructive";
      approval: "none" | "explicit";
      retry: { mode: "never" | "safe"; maxAttempts: number };
      required: boolean;
    }
  | { id: string; remove: true };
export interface WorkflowRecord {
  id: string;
  scope: PolicyScope;
  inputs: Array<{ id: string; required: boolean }>;
  outputs: Array<{ id: string; required: boolean }>;
  settings: Record<string, Json>;
  operations: Setting[];
  constraints: Constraint[];
  steps: WorkflowStep[];
  provenance?: ExternalRuleSetProvenance;
}

const unsafe = new Set(["__proto__", "prototype", "constructor"]);
const plain = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function keys(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, any> {
  requireThat(plain(value) && required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key)), "INVALID_CONFIG");
}
function id(value: unknown): asserts value is string {
  requireThat(typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\x00-\x1f/\\]/.test(value) && !unsafe.has(value), "INVALID_CONFIG");
}
function text(value: unknown, max = 16_384): asserts value is string {
  requireThat(typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00]/.test(value), "INVALID_CONFIG");
}
function unique(values: string[]): void { requireThat(new Set(values).size === values.length, "INVALID_CONFIG"); }
function json(value: unknown): asserts value is Json {
  try { canonicalJson(value); } catch { throw new GovernanceError("INVALID_CONFIG"); }
}
function field(value: unknown): asserts value is string {
  id(value);
  requireThat(value.split(".").every((part) => part.length > 0 && !unsafe.has(part)), "INVALID_CONFIG");
}
export function validatePolicyScope(value: unknown): PolicyScope {
  keys(value, ["kind", "id"]);
  requireThat(["base", "user", "organization", "area", "project", "repository", "workspace"].includes(value.kind), "INVALID_CONFIG");
  id(value.id);
  return structuredClone(value) as PolicyScope;
}
function validateProvenance(value: unknown, scope: PolicyScope): ExternalRuleSetProvenance {
  keys(value, ["sourceRepository", "sourcePath", "sourceRevision", "contentDigest", "declaredScope"]);
  text(value.sourceRepository, 512); text(value.sourcePath); text(value.sourceRevision);
  requireThat(/^[a-f0-9]{64}$/.test(value.contentDigest), "INVALID_CONFIG");
  const declaredScope = validatePolicyScope(value.declaredScope);
  requireThat(canonicalJson(declaredScope) === canonicalJson(scope), "INVALID_CONFIG");
  return structuredClone(value) as ExternalRuleSetProvenance;
}
function validateSettingsObject(value: unknown): Record<string, Json> {
  requireThat(plain(value) && Object.keys(value).length <= 20_000, "INVALID_CONFIG");
  for (const [key, item] of Object.entries(value)) { field(key); json(item); }
  return structuredClone(value) as Record<string, Json>;
}
function validateOperations(value: unknown): Setting[] {
  requireThat(Array.isArray(value) && value.length <= 20_000, "INVALID_CONFIG");
  const out: Setting[] = [];
  for (const operation of value) {
    keys(operation, ["key", "merge"], ["value"]); field(operation.key);
    requireThat(["remove", "append", "set-union", "keyed-merge"].includes(operation.merge), "INVALID_CONFIG");
    if (operation.merge === "remove") requireThat(!Object.hasOwn(operation, "value"), "INVALID_CONFIG");
    else {
      requireThat(Object.hasOwn(operation, "value") && Array.isArray(operation.value), "INVALID_CONFIG");
      json(operation.value);
      if (operation.merge === "keyed-merge") {
        for (const item of operation.value as unknown[]) { requireThat(plain(item), "INVALID_CONFIG"); id((item as Record<string, unknown>).id); }
        unique(operation.value.map((item: any) => item.id));
      }
    }
    out.push(structuredClone(operation) as Setting);
  }
  unique(out.map((item) => item.key));
  return out;
}
function validateConstraints(value: unknown): Constraint[] {
  requireThat(Array.isArray(value) && value.length <= 20_000, "INVALID_CONFIG");
  for (const item of value) {
    keys(item, ["id", "key", "operator", "value"]); id(item.id); field(item.key);
    requireThat(["equals", "forbidden-values", "required-members"].includes(item.operator), "INVALID_CONFIG");
    if (item.operator !== "equals") requireThat(Array.isArray(item.value), "INVALID_CONFIG");
    json(item.value);
  }
  unique(value.map((item: any) => item.id));
  return structuredClone(value) as Constraint[];
}
function namedRecords(value: unknown, kind: "instruction" | "reference"): Array<InstructionRecord | ReferenceRecord> {
  requireThat(Array.isArray(value) && value.length <= 10_000, "INVALID_CONFIG");
  for (const item of value) {
    if (plain(item) && Object.hasOwn(item, "remove")) {
      keys(item, ["id", "remove"]); id(item.id); requireThat(item.remove === true, "INVALID_CONFIG");
    } else {
      keys(item, ["id", kind === "instruction" ? "text" : "reference", "required"]);
      id(item.id); text(item[kind === "instruction" ? "text" : "reference"]);
      requireThat(typeof item.required === "boolean", "INVALID_CONFIG");
    }
  }
  unique(value.map((item: any) => item.id));
  return structuredClone(value) as Array<InstructionRecord | ReferenceRecord>;
}
export function validatePolicyRecord(value: unknown): PolicyRecord {
  keys(value, ["scope", "settings", "operations", "constraints", "instructions", "knowledge", "skills"], ["provenance"]);
  const scope = validatePolicyScope(value.scope);
  const record: PolicyRecord = {
    scope,
    settings: validateSettingsObject(value.settings), operations: validateOperations(value.operations), constraints: validateConstraints(value.constraints),
    instructions: namedRecords(value.instructions, "instruction") as InstructionRecord[],
    knowledge: namedRecords(value.knowledge, "reference") as ReferenceRecord[], skills: namedRecords(value.skills, "reference") as ReferenceRecord[],
    ...(value.provenance === undefined ? {} : { provenance: validateProvenance(value.provenance, scope) }),
  };
  return record;
}
function ioRecords(value: unknown): Array<{ id: string; required: boolean }> {
  requireThat(Array.isArray(value) && value.length <= 1000, "INVALID_CONFIG");
  for (const item of value) { keys(item, ["id", "required"]); id(item.id); requireThat(typeof item.required === "boolean", "INVALID_CONFIG"); }
  unique(value.map((item: any) => item.id)); return structuredClone(value);
}
function workflowSteps(value: unknown): WorkflowStep[] {
  requireThat(Array.isArray(value) && value.length <= 1000, "INVALID_CONFIG");
  for (const step of value) {
    if (plain(step) && Object.hasOwn(step, "remove")) { keys(step, ["id", "remove"]); id(step.id); requireThat(step.remove === true, "INVALID_CONFIG"); continue; }
    keys(step, ["id", "type", "needs", "configuration", "sideEffect", "approval", "retry", "required"]);
    id(step.id); id(step.type); requireThat(Array.isArray(step.needs) && step.needs.length <= 1000, "INVALID_CONFIG"); step.needs.forEach(id); unique(step.needs);
    requireThat(plain(step.configuration), "INVALID_CONFIG"); json(step.configuration);
    requireThat(["none", "workspace", "external", "destructive"].includes(step.sideEffect), "INVALID_CONFIG");
    requireThat(["none", "explicit"].includes(step.approval), "INVALID_CONFIG");
    keys(step.retry, ["mode", "maxAttempts"]); requireThat(["never", "safe"].includes(step.retry.mode), "INVALID_CONFIG");
    requireThat(Number.isInteger(step.retry.maxAttempts) && step.retry.maxAttempts >= 1 && step.retry.maxAttempts <= 10 && (step.retry.mode === "safe" || step.retry.maxAttempts === 1), "INVALID_CONFIG");
    requireThat(typeof step.required === "boolean", "INVALID_CONFIG");
  }
  unique(value.map((step: any) => step.id)); return structuredClone(value) as WorkflowStep[];
}
export function validateWorkflowRecord(value: unknown): WorkflowRecord {
  keys(value, ["id", "scope", "inputs", "outputs", "settings", "operations", "constraints", "steps"], ["provenance"]);
  id(value.id); const scope = validatePolicyScope(value.scope);
  return {
    id: value.id, scope, inputs: ioRecords(value.inputs), outputs: ioRecords(value.outputs), settings: validateSettingsObject(value.settings),
    operations: validateOperations(value.operations), constraints: validateConstraints(value.constraints), steps: workflowSteps(value.steps),
    ...(value.provenance === undefined ? {} : { provenance: validateProvenance(value.provenance, scope) }),
  };
}
export function carriedRuleSetDigest(payload: PolicyRecord | WorkflowRecord): string {
  const carried = structuredClone(payload) as PolicyRecord | WorkflowRecord;
  delete carried.provenance;
  return createHash("sha256").update(canonicalJson(carried)).digest("hex");
}
export function compareCarriedRuleSet(provenance: ExternalRuleSetProvenance, payload: PolicyRecord | WorkflowRecord, sourceBytes: Uint8Array): { status: "matching" | "drift"; expectedDigest: string; actualDigest: string; payloadDigest: string } {
  validateProvenance(provenance, provenance.declaredScope);
  requireThat(sourceBytes.byteLength <= 2 * 1024 * 1024, "INVALID_CONFIG");
  const payloadDigest = carriedRuleSetDigest(payload);
  let actualDigest = "invalid";
  try {
    const parsed = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(sourceBytes));
    actualDigest = createHash("sha256").update(canonicalJson(parsed)).digest("hex");
  } catch {
    // Invalid or non-JSON source bytes are drift, never a write trigger.
  }
  return { status: actualDigest === provenance.contentDigest && payloadDigest === provenance.contentDigest ? "matching" : "drift", expectedDigest: provenance.contentDigest, actualDigest, payloadDigest };
}
