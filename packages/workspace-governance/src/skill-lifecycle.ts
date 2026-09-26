import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

export const SKILLS_CLI_VERSION = "1.7.0";
export const SKILL_NAME = "workspace-governance";
export const SUPPORTED_SKILL_AGENTS = ["hermes-agent", "claude-code"] as const;
export type SupportedSkillAgent = typeof SUPPORTED_SKILL_AGENTS[number];
export type SkillScope = "project" | "global";
export type SkillLifecycleAction = "add" | "remove";
export type ProjectionState = "absent" | "matching" | "conflict";

export class SkillLifecycleError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "SkillLifecycleError";
    this.code = code;
    this.details = details;
  }
}

export interface SkillLifecycleOptions {
  action: SkillLifecycleAction;
  source: string;
  ref: string;
  agents: string[];
  scope: SkillScope;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  yes?: boolean;
}

export interface SkillProjection {
  agent: SupportedSkillAgent;
  path: string;
  state: ProjectionState;
}

export interface SkillLifecyclePlan {
  action: SkillLifecycleAction;
  mutates: false;
  source: string;
  ref: string;
  effectiveSource: string;
  scope: SkillScope;
  projectDirectory: string;
  canonicalPath: string;
  sourceSkillPath: string;
  sourceFingerprint: string;
  sourceType: "local" | "remote";
  receiptPath: string;
  managed: boolean;
  ownedProjections: Array<{ agent: SupportedSkillAgent; path: string }>;
  command: string[];
  projections: SkillProjection[];
}

export interface LifecycleProcessResult { status: number; stdout: string; stderr: string }
export type LifecycleRunner = (input: { plan: SkillLifecyclePlan; env: NodeJS.ProcessEnv }) => Promise<LifecycleProcessResult>;

export interface SkillLifecycleResult {
  ok: boolean;
  action: SkillLifecycleAction;
  noop: boolean;
  source: string;
  ref: string;
  scope: SkillScope;
  projectDirectory: string;
  command: string[];
  exitStatus: number;
  failureCode: "TOOL_FAILURE" | "ACTION_FAILED" | null;
  installerStdout: string;
  installerStderr: string;
  skillVersion: string | null;
  provenance: { source: string; ref: string; skillsCli: string; sourceType: "local" | "remote" };
  canonicalPath: string;
  receiptPath: string;
  canonicalReadback: ProjectionState;
  projections: Array<SkillProjection & { before: ProjectionState; readback: ProjectionState }>;
  changed: Array<{ agent: SupportedSkillAgent; path: string }>;
  unchanged: Array<{ agent: SupportedSkillAgent; path: string; state: ProjectionState }>;
  recoveryCommands: string[];
}

const mutableRefs = new Set(["head", "main", "master", "latest", "next", "dev", "develop", "trunk"]);
const immutableRefPattern = /^(?:local-sha256:[0-9a-f]{64}|[0-9a-f]{40}|[A-Za-z0-9][A-Za-z0-9._/-]*(?:v?\d+\.\d+\.\d+)[A-Za-z0-9._/-]*)$/;
const execFileAsync = promisify(execFile);

function requireInputs(options: SkillLifecycleOptions): SupportedSkillAgent[] {
  if (!isAbsolute(options.cwd) || !options.source || !options.ref || !["project", "global"].includes(options.scope))
    throw new SkillLifecycleError("INVALID_ARGUMENT", "Source, immutable ref, explicit scope, and absolute project cwd are required.");
  if (mutableRefs.has(options.ref.toLowerCase()) || !immutableRefPattern.test(options.ref))
    throw new SkillLifecycleError("INVALID_ARGUMENT", "The skill ref must be an explicit immutable version tag or 40-character commit.", { ref: options.ref });
  if (options.agents.length === 0 || new Set(options.agents).size !== options.agents.length)
    throw new SkillLifecycleError("INVALID_ARGUMENT", "At least one unique supported agent is required.");
  const invalid = options.agents.filter((agent) => !(SUPPORTED_SKILL_AGENTS as readonly string[]).includes(agent));
  if (invalid.length > 0) throw new SkillLifecycleError("UNSUPPORTED_AGENT", `Unsupported Skills CLI agent ID: ${invalid.join(", ")}.`, { supported: SUPPORTED_SKILL_AGENTS });
  return options.agents as SupportedSkillAgent[];
}

function paths(options: SkillLifecycleOptions, agents: SupportedSkillAgent[]) {
  const env = options.env ?? process.env;
  const home = env.HOME || homedir();
  const base = options.scope === "global" ? home : options.cwd;
  const canonicalPath = join(base, ".agents", "skills", SKILL_NAME);
  const projectionPath = (agent: SupportedSkillAgent) => {
    if (options.scope === "project") return join(options.cwd, agent === "hermes-agent" ? ".hermes/skills" : ".claude/skills", SKILL_NAME);
    const agentHome = agent === "hermes-agent" ? (env.HERMES_HOME || join(home, ".hermes")) : (env.CLAUDE_CONFIG_DIR || join(home, ".claude"));
    const relativeHome = relative(resolve(home), resolve(agentHome));
    if (relativeHome.startsWith("..") || isAbsolute(relativeHome))
      throw new SkillLifecycleError("INVALID_ARGUMENT", `${agent === "hermes-agent" ? "HERMES_HOME" : "CLAUDE_CONFIG_DIR"} must remain inside HOME for global scope.`);
    return join(agentHome, "skills", SKILL_NAME);
  };
  return { canonicalPath, projectionPath };
}

function localSkillPath(source: string): string | null {
  if (!isAbsolute(source) && !source.startsWith(".") && !source.startsWith("file:")) return null;
  const local = source.startsWith("file:") ? new URL(source).pathname : resolve(source);
  return local.endsWith(`/skills/${SKILL_NAME}`) || local.endsWith(`/${SKILL_NAME}`) ? local : join(local, "skills", SKILL_NAME);
}

function effectiveSource(source: string, ref: string): string {
  return localSkillPath(source) === null ? `${source.replace(/#.*$/, "")}#${ref}` : source;
}

async function treeFingerprint(root: string): Promise<string | null> {
  try {
    const rootStatus = await lstat(root);
    if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) return null;
    const rows: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === ".git" || entry.name === "metadata.json" || entry.name === "__pycache__" || entry.name === "__pypackages__") continue;
        const path = join(dir, entry.name);
        const name = relative(root, path).replaceAll("\\", "/");
        if (entry.isSymbolicLink()) { rows.push(`L\0${name}\0${await readlink(path)}`); continue; }
        if (entry.isDirectory()) { rows.push(`D\0${name}`); await walk(path); continue; }
        if (!entry.isFile()) { rows.push(`O\0${name}`); continue; }
        const bytes = await readFile(path);
        rows.push(`F\0${name}\0${bytes.length}\0${createHash("sha256").update(bytes).digest("hex")}`);
      }
    };
    await walk(root);
    return createHash("sha256").update(rows.join("\n")).digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function localSourceRef(source: string): Promise<string> {
  const path = localSkillPath(source);
  if (path === null) throw new SkillLifecycleError("INVALID_ARGUMENT", "A local source is required for a local content ref.");
  const fingerprint = await treeFingerprint(path);
  if (fingerprint === null) throw new SkillLifecycleError("INVALID_ARGUMENT", `Local source does not contain ${SKILL_NAME}.`);
  return `local-sha256:${fingerprint}`;
}

async function assertNoSymlinkComponents(base: string, target: string): Promise<void> {
  const absoluteBase = resolve(base), absoluteTarget = resolve(target);
  const remainder = relative(absoluteBase, absoluteTarget);
  if (remainder.startsWith("..") || isAbsolute(remainder)) throw new SkillLifecycleError("INVALID_ARGUMENT", "Skill target escaped its selected scope.");
  let current = absoluteBase;
  const components = remainder.split("/").filter(Boolean);
  for (const component of ["", ...components.slice(0, -1)]) {
    if (component) current = join(current, component);
    try {
      const status = await lstat(current);
      if (status.isSymbolicLink()) throw new SkillLifecycleError("SKILL_CONFLICT", "Refusing a symlinked skill path component.", { path: current });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
}

function remoteUrl(source: string): string {
  if (/^[^/:]+\/[^/]+$/.test(source)) return `https://github.com/${source}.git`;
  if (/^https?:\/\//.test(source) || source.startsWith("git@")) return source.replace(/#.*$/, "");
  throw new SkillLifecycleError("INVALID_ARGUMENT", "Remote skill source must be owner/repository or an explicit Git URL.");
}

async function archivedSkill(repo: string, ref: string, sourcePath: string): Promise<{ path: string; cleanup: string }> {
  const temporary = await mkdtemp(join(tmpdir(), "workspacectl-skill-source-"));
  const archive = join(temporary, "source.tar");
  try {
    await execFileAsync("git", ["-C", repo, "archive", "--format=tar", `--output=${archive}`, ref, sourcePath], { maxBuffer: 1024 * 1024 });
    await execFileAsync("tar", ["-xf", archive, "-C", temporary], { maxBuffer: 1024 * 1024 });
    return { path: join(temporary, sourcePath), cleanup: temporary };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw new SkillLifecycleError("INVALID_ARGUMENT", "The declared immutable ref does not contain the expected skill.", { ref, cause: error instanceof Error ? error.message : String(error) });
  }
}

async function resolveSource(source: string, ref: string): Promise<{ path: string; fingerprint: string; sourceType: "local" | "remote"; cleanup?: string }> {
  const local = localSkillPath(source);
  if (local !== null) {
    const fingerprint = await treeFingerprint(local);
    if (fingerprint === null) throw new SkillLifecycleError("INVALID_ARGUMENT", `Local source does not contain ${SKILL_NAME}.`);
    if (ref.startsWith("local-sha256:")) {
      if (ref !== `local-sha256:${fingerprint}`) throw new SkillLifecycleError("UNTRUSTED_INPUT", "Local source bytes do not match the declared content ref.");
      return { path: local, fingerprint, sourceType: "local" };
    }
    let repoRoot: string;
    try { repoRoot = (await execFileAsync("git", ["-C", local, "rev-parse", "--show-toplevel"])).stdout.trim(); }
    catch { throw new SkillLifecycleError("UNTRUSTED_INPUT", "A version ref for a local source must resolve in its Git repository or use local-sha256:<digest>."); }
    const sourcePath = relative(repoRoot, local).replaceAll("\\", "/");
    const archived = await archivedSkill(repoRoot, ref, sourcePath);
    const archivedFingerprint = await treeFingerprint(archived.path);
    await rm(archived.cleanup, { recursive: true, force: true });
    if (archivedFingerprint !== fingerprint) throw new SkillLifecycleError("UNTRUSTED_INPUT", "Local candidate bytes differ from the declared Git ref.", { ref });
    return { path: local, fingerprint, sourceType: "local" };
  }
  const temporary = await mkdtemp(join(tmpdir(), "workspacectl-skill-remote-"));
  const repo = join(temporary, "repository");
  try {
    await execFileAsync("git", ["clone", "--quiet", "--filter=blob:none", "--no-checkout", remoteUrl(source), repo], { maxBuffer: 1024 * 1024 * 8 });
    const archived = await archivedSkill(repo, ref, `skills/${SKILL_NAME}`);
    const fingerprint = await treeFingerprint(archived.path);
    if (fingerprint === null) throw new Error("missing skill");
    await rm(temporary, { recursive: true, force: true });
    return { path: archived.path, fingerprint, sourceType: "remote", cleanup: archived.cleanup };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error instanceof SkillLifecycleError ? error : new SkillLifecycleError("UNAVAILABLE", "Unable to resolve the exact remote skill source/ref before mutation.", { source, ref });
  }
}

async function canonicalState(path: string, expectedFingerprint: string): Promise<ProjectionState> {
  try {
    const status = await lstat(path);
    if (status.isSymbolicLink() || !status.isDirectory()) return "conflict";
    const actual = await treeFingerprint(path);
    return actual === expectedFingerprint ? "matching" : "conflict";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    throw error;
  }
}

async function projectionState(path: string, canonicalPath: string, canonical: ProjectionState, expectedFingerprint: string): Promise<ProjectionState> {
  try {
    const status = await lstat(path);
    if (status.isSymbolicLink()) return "conflict";
    if (!status.isDirectory()) return "conflict";
    const actual = await treeFingerprint(path);
    return actual === expectedFingerprint ? "matching" : "conflict";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    throw error;
  }
}

interface OwnershipReceipt {
  format: "workspacectl-skill-ownership/1";
  skill: typeof SKILL_NAME;
  source: string;
  ref: string;
  sourceFingerprint: string;
  sourceType: "local" | "remote";
  scope: SkillScope;
  canonicalPath: string;
  skillsCliVersion: typeof SKILLS_CLI_VERSION;
  projections: Array<{ agent: SupportedSkillAgent; path: string }>;
}

interface ReceiptIdentity { dev: bigint; ino: bigint; digest: string }
const receiptIdentities = new WeakMap<SkillLifecyclePlan, ReceiptIdentity | null>();

function receiptPath(canonicalPath: string): string {
  return join(dirname(dirname(canonicalPath)), "skill-receipts", `${SKILL_NAME}.json`);
}

async function readReceipt(path: string): Promise<OwnershipReceipt | null | "conflict"> {
  try {
    const status = await lstat(path);
    if (!status.isFile() || status.isSymbolicLink() || status.size > 64 * 1024) return "conflict";
    const value = JSON.parse(await readFile(path, "utf8"));
    if (value?.format !== "workspacectl-skill-ownership/1" || value.skill !== SKILL_NAME || !Array.isArray(value.projections)) return "conflict";
    return value as OwnershipReceipt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return "conflict";
  }
}

async function receiptIdentity(path: string): Promise<ReceiptIdentity | null> {
  try {
    const status = await lstat(path, { bigint: true });
    if (!status.isFile() || status.isSymbolicLink() || status.size > 64n * 1024n)
      throw new SkillLifecycleError("ACTION_FAILED", "Refusing a replaced skill ownership receipt.");
    return { dev: status.dev, ino: status.ino, digest: createHash("sha256").update(await readFile(path)).digest("hex") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function sameReceiptIdentity(left: ReceiptIdentity | null, right: ReceiptIdentity | null): boolean {
  return left === null || right === null ? left === right : left.dev === right.dev && left.ino === right.ino && left.digest === right.digest;
}

function receiptScopeBase(plan: SkillLifecyclePlan): string {
  return dirname(dirname(dirname(plan.canonicalPath)));
}

async function assertReceiptPath(plan: SkillLifecyclePlan): Promise<void> {
  await assertNoSymlinkComponents(receiptScopeBase(plan), plan.receiptPath);
}

async function assertReceiptUnchanged(plan: SkillLifecyclePlan): Promise<void> {
  await assertReceiptPath(plan);
  const expected = receiptIdentities.get(plan);
  if (expected === undefined || !sameReceiptIdentity(expected, await receiptIdentity(plan.receiptPath)))
    throw new SkillLifecycleError("ACTION_FAILED", "Refusing a concurrently replaced skill ownership receipt.");
}

function receiptMatches(receipt: OwnershipReceipt, options: SkillLifecycleOptions, sourceFingerprint: string, canonicalPath: string, projections: SkillProjection[]): boolean {
  return receipt.source === options.source && receipt.ref === options.ref && receipt.sourceFingerprint === sourceFingerprint && receipt.scope === options.scope && receipt.canonicalPath === canonicalPath && receipt.skillsCliVersion === SKILLS_CLI_VERSION && projections.every((selected) => receipt.projections.some((owned) => owned.agent === selected.agent && owned.path === selected.path));
}

async function saveReceipt(plan: SkillLifecyclePlan, agents: SupportedSkillAgent[]): Promise<void> {
  const projections = [...plan.ownedProjections];
  for (const agent of agents) {
    const selected = plan.projections.find((item) => item.agent === agent);
    if (!selected) throw new SkillLifecycleError("ACTION_FAILED", "Cannot derive ownership projection.");
    const index = projections.findIndex((item) => item.agent === agent);
    const value = { agent, path: selected.path };
    if (index === -1) projections.push(value); else projections[index] = value;
  }
  projections.sort((a, b) => a.agent.localeCompare(b.agent));
  const receipt: OwnershipReceipt = { format: "workspacectl-skill-ownership/1", skill: SKILL_NAME, source: plan.source, ref: plan.ref, sourceFingerprint: plan.sourceFingerprint, sourceType: plan.sourceType, scope: plan.scope, canonicalPath: plan.canonicalPath, skillsCliVersion: SKILLS_CLI_VERSION, projections };
  await assertReceiptUnchanged(plan);
  await mkdir(dirname(plan.receiptPath), { recursive: true, mode: 0o700 });
  await assertReceiptUnchanged(plan);
  if (await readReceipt(plan.receiptPath) === null) await writeFile(plan.receiptPath, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  else {
    const temporary = `${plan.receiptPath}.new-${process.pid}`;
    try {
      await assertReceiptUnchanged(plan);
      await writeFile(temporary, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      await assertReceiptUnchanged(plan);
      await rename(temporary, plan.receiptPath);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  const readback = await readReceipt(plan.receiptPath);
  const selectedForReadback = agents.length === 0 ? [] : plan.projections.filter((item) => agents.includes(item.agent));
  if (readback === null || readback === "conflict" || !receiptMatches(readback, { action: plan.action, source: plan.source, ref: plan.ref, agents, scope: plan.scope, cwd: plan.projectDirectory }, plan.sourceFingerprint, plan.canonicalPath, selectedForReadback))
    throw new SkillLifecycleError("ACTION_FAILED", "Skill ownership receipt readback failed.");
}

async function updateReceiptAfterRemove(plan: SkillLifecyclePlan, removed: SupportedSkillAgent[]): Promise<void> {
  const remaining = plan.ownedProjections.filter((item) => !removed.includes(item.agent));
  if (remaining.length === 0) {
    await assertReceiptUnchanged(plan);
    await rm(plan.receiptPath);
    if (await readReceipt(plan.receiptPath) !== null) throw new SkillLifecycleError("ACTION_FAILED", "Skill ownership receipt removal readback failed.");
    return;
  }
  plan.ownedProjections = remaining;
  await saveReceipt(plan, []);
}

function installerCommand(options: SkillLifecycleOptions, agents: SupportedSkillAgent[], source: string): string[] {
  const command = ["npx", "--yes", `skills@${SKILLS_CLI_VERSION}`];
  if (options.action === "add") command.push("add", source, "--skill", SKILL_NAME, "--agent", ...agents, ...(options.scope === "global" ? ["--global"] : []), "--copy", "--yes", "--json");
  else command.push("remove", SKILL_NAME, "--agent", ...agents, ...(options.scope === "global" ? ["--global"] : []), "--yes");
  return command;
}

export async function planSkillLifecycle(options: SkillLifecycleOptions): Promise<SkillLifecyclePlan> {
  const agents = requireInputs(options);
  const resolvedSource = await resolveSource(options.source, options.ref);
  try {
    const selectedPaths = paths(options, agents);
    const scopeBase = options.scope === "global" ? (options.env?.HOME || homedir()) : options.cwd;
    await Promise.all([
      assertNoSymlinkComponents(scopeBase, selectedPaths.canonicalPath),
      ...agents.map((agent) => assertNoSymlinkComponents(scopeBase, selectedPaths.projectionPath(agent))),
    ]);
    const canonical = await canonicalState(selectedPaths.canonicalPath, resolvedSource.fingerprint);
    const projections = await Promise.all(agents.map(async (agent) => ({
      agent,
      path: selectedPaths.projectionPath(agent),
      state: await projectionState(selectedPaths.projectionPath(agent), selectedPaths.canonicalPath, canonical, resolvedSource.fingerprint),
    })));
    const receiptFile = receiptPath(selectedPaths.canonicalPath);
    await assertNoSymlinkComponents(scopeBase, receiptFile);
    const ownership = await readReceipt(receiptFile);
    if (ownership === "conflict") throw new SkillLifecycleError("SKILL_CONFLICT", "Refusing a malformed, symlinked, or unreadable skill ownership receipt.", { receiptPath: receiptFile });
    const managed = ownership !== null && receiptMatches(ownership, options, resolvedSource.fingerprint, selectedPaths.canonicalPath, projections);
    const anyInstalled = projections.some((projection) => projection.state === "matching");
    if (canonical !== "absent" || projections.some((projection) => projection.state === "conflict") || (anyInstalled && !managed))
      throw new SkillLifecycleError("SKILL_CONFLICT", "Refusing unmanaged, modified, or unexpected symlink skill bytes.", { canonical: { path: selectedPaths.canonicalPath, state: canonical }, projections, receiptPath: receiptFile, managed });
    const installedSource = effectiveSource(options.source, options.ref);
    const plan: SkillLifecyclePlan = {
      action: options.action, mutates: false, source: options.source, ref: options.ref,
      effectiveSource: installedSource, scope: options.scope, projectDirectory: options.cwd,
      canonicalPath: selectedPaths.canonicalPath, sourceSkillPath: resolvedSource.path,
      sourceFingerprint: resolvedSource.fingerprint, sourceType: resolvedSource.sourceType,
      receiptPath: receiptFile, managed, ownedProjections: ownership === null ? [] : ownership.projections,
      command: installerCommand(options, agents, installedSource), projections,
    };
    receiptIdentities.set(plan, await receiptIdentity(receiptFile));
    return plan;
  } finally {
    if (resolvedSource.cleanup) await rm(resolvedSource.cleanup, { recursive: true, force: true });
  }
}

const defaultRunner: LifecycleRunner = ({ plan, env }) => new Promise((resolvePromise, reject) => {
  const [executable, ...args] = plan.command;
  const child = spawn(executable, args, { cwd: plan.projectDirectory, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code) => resolvePromise({ status: code ?? 1, stdout, stderr }));
});

function shell(value: string): string { return `'${value.replaceAll("'", `'"'"'`)}'`; }
function recovery(plan: SkillLifecyclePlan, readback: Array<SkillProjection & { readback: ProjectionState }>): string[] {
  const prefix = `cd ${shell(plan.projectDirectory)} && npx --yes skills@${SKILLS_CLI_VERSION}`;
  const scope = plan.scope === "global" ? " --global" : "";
  const commands: string[] = [];
  for (const item of readback) {
    if (plan.action === "add" && item.readback === "matching") commands.push(`${prefix} remove ${SKILL_NAME} --agent ${item.agent}${scope} --yes`);
    if (plan.action === "add" && item.readback === "absent") commands.push(`${prefix} add ${shell(plan.effectiveSource)} --skill ${SKILL_NAME} --agent ${item.agent}${scope} --copy --yes --json`);
    if (plan.action === "remove" && item.readback !== "absent") commands.push(`${prefix} remove ${SKILL_NAME} --agent ${item.agent}${scope} --yes`);
  }
  return [...new Set(commands)];
}

async function readVersion(path: string): Promise<string | null> {
  try {
    const text = await readFile(join(path, "SKILL.md"), "utf8");
    return /^---\r?\n[\s\S]*?^version:\s*["']?([^\s"']+)["']?\s*$[\s\S]*?^---$/m.exec(text)?.[1] ?? null;
  } catch { return null; }
}

export async function runSkillLifecycle(options: SkillLifecycleOptions, runner: LifecycleRunner = defaultRunner): Promise<SkillLifecycleResult> {
  if (!options.yes) throw new SkillLifecycleError("CONSENT_REQUIRED", "Installation or removal requires --yes after reviewing the exact preview.");
  const plan = await planSkillLifecycle(options);
  const addNoop = plan.action === "add" && plan.projections.every((item) => item.state === "matching");
  const removeNoop = plan.action === "remove" && plan.projections.every((item) => item.state === "absent");
  const before = new Map(plan.projections.map((item) => [item.agent, item.state]));
  let runnerFailed = false;
  let processResult: LifecycleProcessResult;
  if (addNoop || removeNoop) processResult = { status: 0, stdout: "", stderr: "" };
  else {
    try { processResult = await runner({ plan, env: options.env ?? process.env }); }
    catch {
      runnerFailed = true;
      processResult = { status: 1, stdout: "", stderr: "Skills CLI process failed to start or complete." };
    }
  }
  const canonical = await canonicalState(plan.canonicalPath, plan.sourceFingerprint);
  const projections = await Promise.all(plan.projections.map(async (item) => ({ ...item, before: before.get(item.agent)!, readback: await projectionState(item.path, plan.canonicalPath, canonical, plan.sourceFingerprint) })));
  const successReadback = plan.action === "add" ? projections.every((item) => item.readback === "matching") && canonical === "absent" : projections.every((item) => item.readback === "absent");
  let receiptError = "";
  if (processResult.status === 0 && successReadback && !(addNoop || removeNoop)) {
    try {
      if (plan.action === "add") await saveReceipt(plan, plan.projections.map((item) => item.agent));
      else await updateReceiptAfterRemove(plan, plan.projections.map((item) => item.agent));
    } catch (error) {
      receiptError = error instanceof SkillLifecycleError ? error.message : "Skill ownership receipt update failed.";
    }
  }
  const ok = processResult.status === 0 && successReadback && receiptError === "";
  const changed = projections.filter((item) => item.before !== item.readback).map(({ agent, path }) => ({ agent, path }));
  const unchanged = projections.filter((item) => item.before === item.readback).map(({ agent, path, readback }) => ({ agent, path, state: readback }));
  return {
    ok, action: plan.action, noop: addNoop || removeNoop, source: plan.source, ref: plan.ref, scope: plan.scope, projectDirectory: plan.projectDirectory,
    command: plan.command, exitStatus: processResult.status, failureCode: ok ? null : runnerFailed ? "TOOL_FAILURE" : "ACTION_FAILED", installerStdout: processResult.stdout, installerStderr: [processResult.stderr, receiptError].filter(Boolean).join("\n"),
    skillVersion: plan.action === "add" && projections.every((item) => item.readback === "matching") ? await readVersion(projections[0].path) : null,
    provenance: { source: plan.source, ref: plan.ref, skillsCli: SKILLS_CLI_VERSION, sourceType: plan.sourceType },
    canonicalPath: plan.canonicalPath, receiptPath: plan.receiptPath, canonicalReadback: canonical, projections, changed, unchanged,
    recoveryCommands: ok ? [] : recovery(plan, projections),
  };
}
