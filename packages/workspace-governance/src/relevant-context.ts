import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open as openFile, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonicalJson, GovernanceError, requireThat } from "./core.ts";
import { requireStablePath } from "./path-safety.ts";
import { resolveCatalogContext } from "./v2-context.ts";
import type { ResolvedCatalogContext, ResolvedNamedRecord } from "./v2-context.ts";
import { documentRevision } from "./v2-model.ts";
import type { CatalogDocument, GroupRecord, LocalStateDocument } from "./v2-model.ts";

export const DEFAULT_CONTEXT_BUDGET_BYTES = 16_000;
export const DEFAULT_CONTEXT_TOKEN_EQUIVALENT = 4_000;
const MAX_REFERENCE_BYTES = 1024 * 1024;
const MAX_DETAIL_IDS = 32;

type ReferenceCategory = "knowledge" | "skill";
export interface RelevantContextFileOps { open(path: string, flags: number): Promise<FileHandle> }
export interface RelevantContextLoadOptions {
  catalogPath: string;
  trustedRoots: string[];
  load?: string[];
  approvals?: string[];
  budgetBytes?: number;
  groups?: GroupRecord[];
  /** Deterministic test seam; production callers use node:fs/promises.open. */
  fileOps?: RelevantContextFileOps;
}
export interface LoadedContextRecord extends ResolvedNamedRecord {
  status: "linked" | "loaded";
  active: false;
  content?: string;
  contentRevision?: string;
  resolvedPath?: string;
  trust: { approval: "not-required" | "required" | "approved"; approvedRevision: string | null };
}
export interface ContextCommandDefinition {
  key: string;
  value: unknown;
  scope: ResolvedCatalogContext["provenance"][number]["scope"];
  contentRevision: string;
  approval: "required" | "approved";
  active: false;
}
export interface RelevantContext extends Omit<ResolvedCatalogContext, "instructions" | "knowledgeReferences" | "selectedSkills" | "warnings"> {
  organization: { id: string; name: string };
  project: { id: string; name: string } | null;
  instructions: Array<ResolvedNamedRecord & { status: "loaded" }>;
  knowledgeReferences: LoadedContextRecord[];
  selectedSkills: LoadedContextRecord[];
  commandDefinitions: ContextCommandDefinition[];
  displayBudget: { unit: "utf8-bytes"; byteLimit: number; usedBytes: number; tokenEquivalent: number; bytesPerToken: 4 };
  warnings: string[];
}

function revision(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
function parseSelections(values: string[], allowed: readonly string[]): Set<string> {
  requireThat(Array.isArray(values) && values.length <= 10_000, "INVALID_CONFIG");
  const selected = new Set<string>();
  for (const value of values) {
    requireThat(typeof value === "string" && allowed.some((prefix) => value.startsWith(`${prefix}:`)), "INVALID_CONFIG");
    const [category, ...rest] = value.split(":");
    const id = rest.join(":");
    requireThat(id.length > 0 && id.length <= 256 && !selected.has(`${category}:${id}`), "INVALID_CONFIG");
    selected.add(`${category}:${id}`);
  }
  return selected;
}
function parseApprovals(values: string[]): Map<string, string> {
  requireThat(Array.isArray(values) && values.length <= 10_000, "INVALID_CONFIG");
  const approvals = new Map<string, string>();
  for (const value of values) {
    requireThat(typeof value === "string", "INVALID_CONFIG");
    const split = value.lastIndexOf("=");
    requireThat(split > 0, "INVALID_CONFIG");
    const target = value.slice(0, split), approvedRevision = value.slice(split + 1);
    requireThat(/^(?:knowledge|skill|command):[^=]+$/.test(target) && /^sha256:[a-f0-9]{64}$/.test(approvedRevision) && !approvals.has(target), "INVALID_CONFIG");
    approvals.set(target, approvedRevision);
  }
  return approvals;
}
function contains(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}
interface StablePathIdentity {
  path: string;
  canonicalPath: string;
  dev: number;
  ino: number;
  type: number;
}
async function pathIdentity(path: string): Promise<StablePathIdentity> {
  const status = await lstat(path);
  return {
    path,
    canonicalPath: await realpath(path),
    dev: status.dev,
    ino: status.ino,
    type: status.mode & constants.S_IFMT,
  };
}
async function directoryChain(root: string, target: string): Promise<StablePathIdentity[]> {
  const parent = dirname(target);
  requireThat(contains(root, parent), "UNTRUSTED_INPUT");
  const suffix = relative(root, parent).split(sep).filter(Boolean);
  const paths = [root];
  for (const part of suffix) paths.push(join(paths[paths.length - 1], part));
  const identities = await Promise.all(paths.map(pathIdentity));
  requireThat(identities.every((entry) => entry.type === constants.S_IFDIR && entry.canonicalPath === entry.path), "UNTRUSTED_INPUT");
  return identities;
}
async function chainUnchanged(chain: StablePathIdentity[]): Promise<boolean> {
  try {
    for (const expected of chain) {
      const current = await pathIdentity(expected.path);
      if (current.canonicalPath !== expected.canonicalPath || current.dev !== expected.dev || current.ino !== expected.ino || current.type !== expected.type) return false;
    }
    return true;
  } catch {
    return false;
  }
}
function declaredBase(record: ResolvedNamedRecord, catalogPath: string): string {
  const catalogBase = dirname(resolve(catalogPath));
  const sourcePath = record.provenance?.sourcePath;
  if (sourcePath === undefined) return catalogBase;
  return dirname(isAbsolute(sourcePath) ? sourcePath : resolve(catalogBase, sourcePath));
}
function decodeText(bytes: Uint8Array, category: string, targetId: string): string {
  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (value.includes("\0")) throw new GovernanceError("INVALID_CONFIG", { category, targetId, reason: "malformed-target" });
    return value;
  } catch (error) {
    if (error instanceof GovernanceError) throw error;
    throw new GovernanceError("INVALID_CONFIG", { category, targetId, reason: "malformed-target" });
  }
}
function validateInlineText(record: ResolvedNamedRecord): void {
  const text = record.text;
  const malformed = typeof text !== "string" || text.includes("\0") || Buffer.byteLength(text, "utf8") > MAX_REFERENCE_BYTES || /[\uD800-\uDFFF]/u.test(text);
  if (malformed) throw new GovernanceError("INVALID_CONFIG", { category: "instruction", targetId: record.id, reason: "malformed-target" });
}
async function readCapped(handle: FileHandle): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= MAX_REFERENCE_BYTES) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_REFERENCE_BYTES + 1 - total));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead));
    total += bytesRead;
  }
  return Buffer.concat(chunks, total);
}
async function trustedFile(record: ResolvedNamedRecord, category: ReferenceCategory, options: RelevantContextLoadOptions): Promise<{ path: string; bytes: Buffer; text: string }> {
  requireThat(typeof record.reference === "string" && record.reference.length > 0 && record.reference.length <= 4096 && !/[\x00\r\n]/.test(record.reference), "INVALID_CONFIG");
  requireThat(!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(record.reference), "UNTRUSTED_INPUT");
  const target = resolve(declaredBase(record, options.catalogPath), record.reference);
  let roots: string[];
  try {
    roots = await Promise.all(options.trustedRoots.map(async (root) => {
      requireThat(isAbsolute(root), "INVALID_CONFIG");
      await requireStablePath(root, { code: "UNTRUSTED_INPUT" });
      return realpath(root);
    }));
  } catch (error) {
    if (error instanceof GovernanceError) throw error;
    throw new GovernanceError("UNTRUSTED_INPUT", { category, targetId: record.id, reason: "invalid-trusted-root" });
  }
  let handle: FileHandle | undefined;
  try {
    try {
      const initial = await lstat(target);
      requireThat(!initial.isSymbolicLink(), "UNTRUSTED_INPUT");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        if (record.required) throw new GovernanceError("INCOMPLETE", { category, targetId: record.id, reason: "missing-required-target" });
        throw new GovernanceError("UNTRUSTED_INPUT", { category, targetId: record.id, reason: "missing-optional-target" });
      }
      throw error;
    }
    await requireStablePath(target, { code: "UNTRUSTED_INPUT" });
    const targetReal = await realpath(target);
    const trustedRoot = roots.filter((root) => contains(root, targetReal)).sort((left, right) => right.length - left.length)[0];
    requireThat(trustedRoot !== undefined, "UNTRUSTED_INPUT");
    const chain = await directoryChain(trustedRoot, targetReal);
    const initialTarget = await pathIdentity(targetReal);
    requireThat(initialTarget.type === constants.S_IFREG && initialTarget.canonicalPath === targetReal, "UNTRUSTED_INPUT");
    const opener = options.fileOps?.open ?? openFile;
    const noFollow = constants.O_NOFOLLOW ?? 0;
    try { handle = await opener(target, constants.O_RDONLY | noFollow); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (noFollow !== 0 && (code === "EINVAL" || code === "ENOTSUP" || code === "EOPNOTSUPP")) handle = await opener(target, constants.O_RDONLY);
      else throw error;
    }
    const before = await handle.stat();
    if (!before.isFile() || before.dev !== initialTarget.dev || before.ino !== initialTarget.ino || (before.mode & constants.S_IFMT) !== initialTarget.type || !(await chainUnchanged(chain)))
      throw new GovernanceError("UNTRUSTED_INPUT", { category, targetId: record.id, reason: "path-drift" });
    if (before.size > MAX_REFERENCE_BYTES)
      throw new GovernanceError(record.required ? "INCOMPLETE" : "UNTRUSTED_INPUT", { category, targetId: record.id, reason: "target-oversized", requiredBytes: before.size, maximumBytes: MAX_REFERENCE_BYTES });
    const bytes = await readCapped(handle);
    if (bytes.length > MAX_REFERENCE_BYTES)
      throw new GovernanceError(record.required ? "INCOMPLETE" : "UNTRUSTED_INPUT", { category, targetId: record.id, reason: "target-oversized", requiredBytes: bytes.length, maximumBytes: MAX_REFERENCE_BYTES });
    const after = await handle.stat();
    const pathStatus = await lstat(target);
    const finalReal = await realpath(target);
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || bytes.length !== after.size || pathStatus.isSymbolicLink() || pathStatus.dev !== after.dev || pathStatus.ino !== after.ino || finalReal !== targetReal || !contains(trustedRoot, finalReal) || !(await chainUnchanged(chain)))
      throw new GovernanceError("UNTRUSTED_INPUT", { category, targetId: record.id, reason: "path-drift" });
    return { path: finalReal, bytes, text: decodeText(bytes, category, record.id) };
  } catch (error) {
    if (error instanceof GovernanceError) {
      if (error.code === "UNTRUSTED_INPUT" && (error.details === undefined || (error.details as Record<string, unknown>).targetId === undefined))
        throw new GovernanceError("UNTRUSTED_INPUT", { category, targetId: record.id, reason: "untrusted-path" });
      throw error;
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" && record.required) throw new GovernanceError("INCOMPLETE", { category, targetId: record.id, reason: "missing-required-target" });
    throw new GovernanceError("UNTRUSTED_INPUT", { category, targetId: record.id, reason: code === "ENOENT" ? "missing-optional-target" : "unavailable-target" });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function renderRelevantContextText(context: RelevantContext): string {
  return [
    `context ${context.repositoryId}`,
    `Organization: ${context.organization.name} (${context.organization.id})`,
    `Project: ${context.project === null ? "(none)" : `${context.project.name} (${context.project.id})`}`,
    `Repository: ${context.repositoryId}`,
    `Workspace: ${context.workspaceId ?? "(none)"}`,
    `Display budget: ${context.displayBudget.usedBytes}/${context.displayBudget.byteLimit} ${context.displayBudget.unit} (${context.displayBudget.tokenEquivalent} token equivalent)`,
    "Effective command definitions (inactive):",
    ...context.commandDefinitions.map((entry) => `  ${entry.key} = ${JSON.stringify(entry.value)} [${entry.approval}; inactive]`),
    "Mandatory rules (loaded; natural-language only):",
    ...context.instructions.filter((entry) => entry.required).map((entry) => `  ${entry.id}: ${entry.text} [${entry.status}]`),
    `Selected workflow: ${context.workflow?.id ?? "(none)"} (inert; executable=false)`,
    "Linked references:",
    ...context.knowledgeReferences.map((entry) => `  knowledge ${entry.id}: ${entry.reference} [${entry.status}; ${entry.trust.approval}; inactive]`),
    ...context.selectedSkills.map((entry) => `  skill ${entry.id}: ${entry.reference} [${entry.status}; ${entry.trust.approval}; inactive]`),
    "Final settings:",
    ...Object.entries(context.settings).map(([key, value]) => `  ${key} = ${JSON.stringify(value)}`),
    "Setting operations and provenance:", ...context.provenance.map((entry) => `  ${JSON.stringify(entry)}`),
    "Constraints and provenance:", ...context.constraints.map((entry) => `  ${JSON.stringify(entry)}`),
    "Resolved named records:",
    ...context.instructions.map(({ text: _text, ...entry }) => `  instruction ${JSON.stringify(entry)}`),
    ...context.knowledgeReferences.map((entry) => `  knowledge ${JSON.stringify(entry)}`),
    ...context.selectedSkills.map((entry) => `  skill ${JSON.stringify(entry)}`),
    "Named record changes and provenance:", ...context.recordProvenance.map((entry) => `  ${JSON.stringify(entry)}`),
    "Resolved workflow steps:", ...(context.workflow?.steps.map((entry) => `  ${JSON.stringify(entry)}`) ?? []),
    "Workflow step changes and provenance:", ...(context.workflow?.provenance.map((entry) => `  ${JSON.stringify(entry)}`) ?? []),
  ].join("\n") + "\n";
}
function measuredBytes(context: RelevantContext): number {
  let previous = -1;
  for (let index = 0; index < 8; index += 1) {
    const rendered = Buffer.byteLength(renderRelevantContextText(context), "utf8");
    const serialized = Buffer.byteLength(canonicalJson(context as never), "utf8");
    const next = Math.max(rendered, serialized);
    context.displayBudget.usedBytes = next;
    if (next === previous) return next;
    previous = next;
  }
  return context.displayBudget.usedBytes;
}
function oversized(requiredBytes: number, budgetBytes: number, ids: string[]): never {
  throw new GovernanceError("INCOMPLETE", { reason: "oversized-context", offendingIds: ids.slice(0, MAX_DETAIL_IDS), offendingIdCount: ids.length, requiredBytes, budgetBytes });
}

export async function loadRelevantContext(baseInput: ResolvedCatalogContext, options: RelevantContextLoadOptions): Promise<RelevantContext> {
  requireThat(options && typeof options === "object" && isAbsolute(options.catalogPath), "INVALID_CONFIG");
  requireThat(Array.isArray(options.trustedRoots) && options.trustedRoots.length > 0 && options.trustedRoots.length <= 64, "INVALID_CONFIG");
  const budgetBytes = options.budgetBytes ?? DEFAULT_CONTEXT_BUDGET_BYTES;
  requireThat(Number.isSafeInteger(budgetBytes) && budgetBytes >= 1 && budgetBytes <= 16 * 1024 * 1024, "INVALID_CONFIG");
  const requested = parseSelections(options.load ?? [], ["knowledge", "skill"]);
  const approvals = parseApprovals(options.approvals ?? []);
  const base = structuredClone(baseInput);
  const warnings = [...base.warnings];
  const instructions: RelevantContext["instructions"] = [];
  for (const instruction of base.instructions) {
    try { validateInlineText(instruction); }
    catch (error) {
      if (instruction.required) throw error;
      warnings.push(`optional-instruction-omitted:${instruction.id}:malformed-target`);
      continue;
    }
    instructions.push({ ...instruction, status: "loaded" });
    if (!instruction.required) warnings.push(`optional-instruction-omitted:${instruction.id}:summary`);
  }
  const commandDefinitions: ContextCommandDefinition[] = Object.keys(base.settings).filter((key) => key.startsWith("commands.") || key.endsWith(".url"))
    .sort().map((key) => {
      const source = [...base.provenance].reverse().find((entry) => entry.key === key);
      requireThat(source !== undefined, "INVALID_CONFIG");
      const contentRevision = revision(canonicalJson({ key, value: base.settings[key], scope: source.scope }));
      const approvedRevision = approvals.get(`command:${key}`);
      if (approvedRevision !== undefined && approvedRevision !== contentRevision)
        throw new GovernanceError("UNTRUSTED_INPUT", { category: "command", targetId: key, reason: "renewed-review-required", currentRevision: contentRevision, approvedRevision });
      return { key, value: base.settings[key], scope: source.scope, contentRevision, approval: approvedRevision === contentRevision ? "approved" : "required", active: false };
    });
  const knownTargets = new Set([
    ...base.knowledgeReferences.map((record) => `knowledge:${record.id}`),
    ...base.selectedSkills.map((record) => `skill:${record.id}`),
    ...commandDefinitions.map((record) => `command:${record.key}`),
  ]);
  for (const target of approvals.keys()) if (!knownTargets.has(target))
    throw new GovernanceError("INVALID_CONFIG", { reason: "unknown-approval-target", targetId: target });
  for (const target of requested) if (!knownTargets.has(target)) {
    const [category, ...parts] = target.split(":");
    throw new GovernanceError("NOT_FOUND", { targetId: parts.join(":"), category });
  }
  const loadRecords = async (records: ResolvedNamedRecord[], category: ReferenceCategory): Promise<LoadedContextRecord[]> => {
    const output: LoadedContextRecord[] = [];
    for (const record of records) {
      const key = `${category}:${record.id}`;
      const selected = requested.has(key);
      let file: Awaited<ReturnType<typeof trustedFile>> | undefined;
      try { file = await trustedFile(record, category, options); }
      catch (error) {
        if (record.required || selected) throw error;
        const reason = error instanceof GovernanceError && typeof error.details === "object" && error.details !== null && "reason" in error.details ? String(error.details.reason) : "unavailable-target";
        warnings.push(`optional-${category}-inactive:${record.id}:${reason}`);
      }
      const contentRevision = file === undefined ? undefined : revision(file.bytes);
      const approvedRevision = approvals.get(key);
      const approvalRequired = record.provenance !== undefined || record.scope.kind === "repository" || record.scope.kind === "workspace" || selected;
      const approval = contentRevision !== undefined && approvedRevision === contentRevision ? "approved" as const : "required" as const;
      if (selected && approval !== "approved")
        throw new GovernanceError("UNTRUSTED_INPUT", { category, targetId: record.id, reason: "renewed-review-required", currentRevision: contentRevision ?? null, approvedRevision: approvedRevision ?? null });
      const loaded: LoadedContextRecord = {
        ...record, status: "linked", active: false,
        trust: { approval: approvalRequired ? approval : "not-required", approvedRevision: approvedRevision ?? null },
        ...(contentRevision === undefined ? {} : { contentRevision, resolvedPath: file!.path }),
      };
      if (selected && file !== undefined) { loaded.status = "loaded"; loaded.content = file.text; }
      output.push(loaded);
    }
    return output;
  };
  const knowledgeReferences = await loadRecords(base.knowledgeReferences, "knowledge");
  const selectedSkills = await loadRecords(base.selectedSkills, "skill");
  const groups = new Map((options.groups ?? []).map((group) => [group.id, group]));
  const organizationId = base.ancestry.find((id) => groups.get(id)?.kind === "organization") ?? base.ancestry[0];
  const projectId = base.selectedProjectId ?? base.ancestry.find((id) => groups.get(id)?.kind === "project") ?? null;
  const context: RelevantContext = {
    ...base,
    organization: { id: organizationId, name: groups.get(organizationId)?.name ?? organizationId },
    project: projectId === null ? null : { id: projectId, name: groups.get(projectId)?.name ?? projectId },
    instructions, knowledgeReferences, selectedSkills, commandDefinitions,
    displayBudget: { unit: "utf8-bytes", byteLimit: budgetBytes, usedBytes: 0, tokenEquivalent: Math.floor(budgetBytes / 4), bytesPerToken: 4 },
    warnings,
  };
  let usedBytes = measuredBytes(context);
  for (let index = context.instructions.length - 1; index >= 0 && usedBytes > budgetBytes; index -= 1) {
    if (!context.instructions[index].required) {
      context.instructions.splice(index, 1);
      usedBytes = measuredBytes(context);
    }
  }
  for (const [category, records] of [["knowledge", knowledgeReferences], ["skill", selectedSkills]] as const) {
    for (const record of records) if (usedBytes > budgetBytes && record.status === "loaded" && !record.required) {
      delete record.content;
      record.status = "linked";
      warnings.push(`optional-${category}-omitted:${record.id}:budget`);
      usedBytes = measuredBytes(context);
    }
  }
  if (usedBytes > budgetBytes) {
    const ids = [
      ...context.instructions.filter((record) => record.required).map((record) => record.id),
      ...knowledgeReferences.filter((record) => record.required).map((record) => record.id),
      ...selectedSkills.filter((record) => record.required).map((record) => record.id),
      ...commandDefinitions.map((record) => record.key),
      ...(context.workflow === null ? [] : [context.workflow.id]),
    ];
    oversized(usedBytes, budgetBytes, ids);
  }
  return context;
}

export interface ProjectContextRequest extends RelevantContextLoadOptions { projectId: string; repositoryIds: string[]; workspaceIds?: Record<string, string>; workflowId?: string }
export async function resolveProjectContexts(catalogInput: unknown, stateInput: unknown, request: ProjectContextRequest): Promise<{ schemaVersion: 2; projectId: string; sharedProjectContext: RelevantContext; repositoryContexts: RelevantContext[] }> {
  requireThat(request && typeof request.projectId === "string" && Array.isArray(request.repositoryIds) && request.repositoryIds.length > 0 && new Set(request.repositoryIds).size === request.repositoryIds.length, "INVALID_CONFIG");
  const catalog = structuredClone(catalogInput) as CatalogDocument;
  const state = structuredClone(stateInput) as LocalStateDocument;
  const revisions = { catalog: documentRevision(catalogInput), localState: documentRevision(stateInput) };
  const loadOptions: RelevantContextLoadOptions = {
    catalogPath: request.catalogPath, trustedRoots: request.trustedRoots,
    ...(request.load === undefined ? {} : { load: request.load }),
    ...(request.approvals === undefined ? {} : { approvals: request.approvals }),
    ...(request.budgetBytes === undefined ? {} : { budgetBytes: request.budgetBytes }),
    groups: request.groups ?? catalog.groups,
    ...(request.fileOps === undefined ? {} : { fileOps: request.fileOps }),
  };
  const repositoryIds = [...request.repositoryIds].sort();
  const repositoryContexts = await Promise.all(repositoryIds.map(async (repositoryId) => {
    const workspaceId = request.workspaceIds?.[repositoryId];
    const base = resolveCatalogContext(catalog, state, { repositoryId, ...(workspaceId === undefined ? {} : { workspaceId }), selectedProjectId: request.projectId, ...(request.workflowId === undefined ? {} : { workflowId: request.workflowId }) });
    base.revisions = revisions;
    return loadRelevantContext(base, loadOptions);
  }));
  const userRepositoryIds = new Set(catalog.repositories.map((repository) => repository.id));
  let syntheticId: string | undefined;
  for (let index = 0; index <= userRepositoryIds.size; index += 1) {
    const suffix = index === 0 ? "" : `-${index}`;
    const candidate = `$shared-${request.projectId}`.slice(0, 256 - suffix.length) + suffix;
    if (!userRepositoryIds.has(candidate)) { syntheticId = candidate; break; }
  }
  requireThat(syntheticId !== undefined, "INVALID_CONFIG");
  catalog.repositories.push({ id: syntheticId, remote: `https://github.com/workspacectl/shared-${createHash("sha256").update(`${request.projectId}\0${syntheticId}`).digest("hex").slice(0, 12)}`, sourceId: null, primaryGroupId: request.projectId, memberOf: [], aliases: [], classification: "confirmed", metadata: {} });
  const sharedBase = resolveCatalogContext(catalog, state, { repositoryId: syntheticId, selectedProjectId: request.projectId, ...(request.workflowId === undefined ? {} : { workflowId: request.workflowId }) });
  sharedBase.revisions = revisions;
  const sharedProjectContext = await loadRelevantContext(sharedBase, loadOptions);
  return { schemaVersion: 2, projectId: request.projectId, sharedProjectContext, repositoryContexts };
}
