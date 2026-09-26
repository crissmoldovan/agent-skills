import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, open, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { GovernanceError } from "./core.ts";
import { createBuiltinStoreRegistry } from "./document-stores.ts";
import { loadWorkspacesConfig } from "./registry-plans.ts";
import { requireStablePath } from "./path-safety.ts";

export const CLI_VERSION = "0.3.0";

type SelectionSource = "cli" | "environment" | "xdg" | "default";
type DoctorErrorCode =
  | "NOT_CONFIGURED"
  | "INVALID_CONFIG"
  | "INCOMPLETE"
  | "ACTION_FAILED";

export interface DoctorDiagnosis {
  ok: boolean;
  command: "doctor";
  cliVersion: "0.3.0";
  milestone: "M2/A03";
  readinessScope: "integration" | "standalone";
  ready: boolean;
  selected: {
    config: { path: string; source: SelectionSource };
    skill: { path: string; source: SelectionSource } | null;
  };
  checks: Array<Record<string, unknown> & { id: string; status: string }>;
  error?: {
    code: DoctorErrorCode;
    message: string;
    details: { remedies: string[] };
  };
}

interface DiagnoseOptions {
  configPath?: string;
  skillPath?: string;
  standalone?: boolean;
  cliPath?: string;
  env?: NodeJS.ProcessEnv;
}

export function selectConfigPath(
  explicit: string | undefined,
  env: NodeJS.ProcessEnv,
) {
  if (explicit !== undefined)
    return { path: resolve(explicit), source: "cli" as const };
  if (env.WORKSPACECTL_CONFIG)
    return {
      path: resolve(env.WORKSPACECTL_CONFIG),
      source: "environment" as const,
    };
  if (env.XDG_CONFIG_HOME)
    return {
      path: resolve(env.XDG_CONFIG_HOME, "workspacectl", "config.yaml"),
      source: "xdg" as const,
    };
  return {
    path: resolve(
      env.HOME || homedir(),
      ".config",
      "workspacectl",
      "config.yaml",
    ),
    source: "default" as const,
  };
}

function selectedSkill(explicit: string | undefined, env: NodeJS.ProcessEnv) {
  if (explicit !== undefined)
    return { path: resolve(explicit), source: "cli" as const };
  if (env.WORKSPACECTL_SKILL)
    return {
      path: resolve(env.WORKSPACECTL_SKILL),
      source: "environment" as const,
    };
  return {
    path: resolve(
      env.HOME || homedir(),
      ".hermes",
      "skills",
      "workspace-governance",
      "SKILL.md",
    ),
    source: "default" as const,
  };
}

async function regularFileStatus(
  path: string,
): Promise<"present" | "missing" | "invalid"> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return "invalid";
    const handle = await open(path, "r");
    await handle.close();
    return "present";
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return "missing";
    return "invalid";
  }
}

async function inspectSkill(path: string) {
  const fileStatus = await regularFileStatus(path);
  const remedy =
    `Install workspace-governance skill v${CLI_VERSION} separately at the selected path ` +
    "or pass --skill FILE.";
  if (fileStatus !== "present")
    return {
      id: "skill",
      status: fileStatus,
      path,
      expectedVersion: CLI_VERSION,
      remedy,
    };
  const text = await readFile(path, "utf8");
  const frontmatter = text.match(
    /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
  )?.[1];
  const name = frontmatter?.match(/^name:\s*([^\s]+)\s*$/m)?.[1];
  const version = frontmatter?.match(/^version:\s*([^\s]+)\s*$/m)?.[1];
  if (name === "workspace-governance" && version === CLI_VERSION)
    return { id: "skill", status: "pass", path, version };
  if (name === "workspace-governance" && version)
    return {
      id: "skill",
      status: "mismatch",
      path,
      version,
      expectedVersion: CLI_VERSION,
      remedy,
    };
  return {
    id: "skill",
    status: "invalid",
    path,
    expectedVersion: CLI_VERSION,
    remedy,
  };
}

async function inspectInstall(env: NodeJS.ProcessEnv, cliPath: string) {
  const prefix = env.WORKSPACECTL_INSTALL_PREFIX;
  const launcher = env.WORKSPACECTL_LAUNCHER;
  const runtime = env.WORKSPACECTL_RUNTIME_PATH;
  const remedy =
    "Run the reviewed local installer to verify a packed, versioned installation.";
  if (prefix === undefined && launcher === undefined && runtime === undefined)
    return { id: "install", status: "source", version: CLI_VERSION, remedy };
  if (
    !prefix ||
    !launcher ||
    !runtime ||
    !isAbsolute(prefix) ||
    !isAbsolute(launcher) ||
    !isAbsolute(runtime)
  ) return { id: "install", status: "invalid", version: CLI_VERSION, remedy };

  const expectedCli = join(
    prefix,
    "lib",
    "node_modules",
    "@crissmoldovan",
    "workspace-governance",
    "dist",
    "cli.js",
  );
  const markerPath = join(prefix, ".workspacectl-install.json");
  try {
    const receiptPath = join(prefix, "manager-receipt.json");
    if ((await regularFileStatus(receiptPath)) === "present") {
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      const version = receipt.activeVersion;
      const launcherName = Object.entries(receipt.launchers ?? {}).find(
        ([, value]) => (value as { path?: unknown })?.path === launcher,
      )?.[0];
      const entrypoint = launcherName === "workspacectl"
        ? "cli.js"
        : launcherName === "workspacectl-mcp"
          ? "mcp-cli.js"
          : undefined;
      const launcherRecord = entrypoint === undefined
        ? undefined
        : receipt.launchers[launcherName!];
      const managedCli = entrypoint === undefined
        ? ""
        : join(prefix, "versions", version, "lib", "node_modules", "@crissmoldovan", "workspace-governance", "dist", entrypoint);
      const launcherBytes = await readFile(launcher);
      if (receipt.schemaVersion !== 2 || receipt.package !== "@crissmoldovan/workspace-governance" || version !== CLI_VERSION || receipt.versions?.[version]?.root !== join(prefix, "versions", version) || launcherRecord?.targetVersion !== version || createHash("sha256").update(launcherBytes).digest("hex") !== launcherRecord?.sha256 || cliPath !== managedCli || process.execPath !== runtime || (await regularFileStatus(managedCli)) !== "present" || !launcherBytes.toString("utf8").startsWith("#!/bin/sh\n# workspacectl-managed-launcher-v2\n")) return { id: "install", status: "invalid", version: CLI_VERSION, remedy };
      return { id: "install", status: "pass", version: CLI_VERSION, prefix, launcher, runtime, cliPath };
    }
    if (
      cliPath !== expectedCli ||
      process.execPath !== runtime ||
      (await regularFileStatus(markerPath)) !== "present" ||
      (await regularFileStatus(launcher)) !== "present" ||
      (await regularFileStatus(expectedCli)) !== "present" ||
      !(await readFile(launcher, "utf8")).startsWith(
        "#!/bin/sh\n# workspacectl-managed-launcher-v1\n",
      )
    ) return { id: "install", status: "invalid", version: CLI_VERSION, remedy };
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    if (
      marker.schemaVersion !== 1 ||
      marker.package !== "@crissmoldovan/workspace-governance" ||
      marker.version !== CLI_VERSION ||
      marker.prefix !== prefix ||
      marker.launcher !== launcher ||
      marker.runtime !== runtime
    ) return { id: "install", status: "invalid", version: CLI_VERSION, remedy };
  } catch {
    return { id: "install", status: "invalid", version: CLI_VERSION, remedy };
  }
  return {
    id: "install",
    status: "pass",
    version: CLI_VERSION,
    prefix,
    launcher,
    runtime,
    cliPath,
  };
}

async function inspectPathLauncher(env: NodeJS.ProcessEnv) {
  const prefix = env.WORKSPACECTL_INSTALL_PREFIX;
  if (!prefix) return { id: "path-launcher", status: "skipped", required: false, reason: "Source/direct invocation has no owned PATH launcher." };
  let expected: string | undefined;
  try {
    const receipt = JSON.parse(await readFile(join(prefix, "manager-receipt.json"), "utf8"));
    expected = receipt.launchers?.workspacectl?.path;
  } catch {}
  if (!expected) return { id: "path-launcher", status: "invalid", remedy: "Restore the managed receipt before selecting a workspacectl launcher on PATH." };
  let actual: string | undefined;
  for (const directory of (env.PATH ?? "").split(":")) {
    if (!directory) continue;
    const candidate = resolve(directory, "workspacectl");
    try {
      const metadata = await lstat(candidate);
      if (metadata.isFile() && !metadata.isSymbolicLink() && (metadata.mode & 0o111) !== 0) { actual = candidate; break; }
    } catch {}
  }
  if (actual === expected) return { id: "path-launcher", status: "pass", actual, expected };
  return {
    id: "path-launcher",
    status: actual ? "shadowed" : "missing",
    ...(actual ? { actual } : {}),
    expected,
    remedy: actual
      ? `PATH resolves workspacectl to ${actual}; place the owned launcher ${expected} first or invoke it explicitly.`
      : `Add the owned launcher directory ${resolve(expected, "..")} to PATH or invoke ${expected} explicitly.`,
  };
}

export function checkNodeVersion(actual: string) {
  const major = Number(actual.split(".")[0]);
  if (Number.isInteger(major) && major >= 24)
    return {
      id: "runtime",
      status: "pass",
      actual,
      required: ">=24.0.0",
    };
  return {
    id: "runtime",
    status: "fail",
    actual,
    required: ">=24.0.0",
    remedy: "Install Node.js 24 or newer separately, then reinstall workspacectl.",
  };
}

async function realDirectory(path: string): Promise<boolean> {
  try {
    await requireStablePath(path);
    const status = await lstat(path);
    return status.isDirectory() && !status.isSymbolicLink();
  } catch {
    return false;
  }
}

async function inspectConfiguredResources(configPath: string) {
  const configRemedy =
    `Run workspacectl init with the selected config ${configPath}, review its plan, ` +
    "then apply that exact plan.";
  const status = await regularFileStatus(configPath);
  if (status !== "present")
    return {
      config: {
        id: "config",
        status,
        path: configPath,
        validated: false,
        remedy: configRemedy,
      },
      trustedRoots: {
        id: "trusted-roots",
        status: "blocked",
        verified: false,
      },
      catalog: { id: "catalog", status: "blocked", verified: false },
      localState: {
        id: "local-state",
        status: "blocked",
        verified: false,
      },
      store: { id: "store", status: "blocked", verified: false },
    };

  try {
    const loaded = await loadWorkspacesConfig(configPath);
    const config = loaded.document;
    const rootResults = await Promise.all(
      config.trustedRoots.map(async (path) => ({
        path,
        status: (await realDirectory(path)) ? "pass" : "invalid",
      })),
    );
    const trustedRootsPass = rootResults.every((entry) => entry.status === "pass");
    const registry = createBuiltinStoreRegistry();
    const catalog = await registry
      .createCatalog(config.catalog.adapter, config.catalog.path)
      .read();
    const localState = await registry
      .createLocalState(config.localState.adapter, config.localState.path)
      .read();
    const catalogPass =
      catalog.document !== null &&
      catalog.freshness === "current" &&
      catalog.capabilities.read === true &&
      catalog.capabilities.compareAndSwap === "supported";
    const localStatePass =
      localState.document !== null &&
      localState.freshness === "current" &&
      localState.capabilities.read === true &&
      localState.capabilities.compareAndSwap === "supported" &&
      localState.document.selectedConfig.path === configPath &&
      localState.document.selectedConfig.revision === loaded.revision;
    return {
      config: {
        id: "config",
        status: "pass",
        path: configPath,
        validated: true,
        revision: loaded.revision,
      },
      trustedRoots: {
        id: "trusted-roots",
        status: trustedRootsPass ? "pass" : "invalid",
        verified: trustedRootsPass,
        count: rootResults.length,
        roots: rootResults,
        ...(trustedRootsPass
          ? {}
          : { remedy: "Restore or correct every explicitly configured trusted root." }),
      },
      catalog: {
        id: "catalog",
        status: catalogPass ? "pass" : catalog.document === null ? "missing" : "invalid",
        verified: catalogPass,
        path: config.catalog.path,
        revision: catalog.revision,
        capabilities: catalog.capabilities,
        freshness: catalog.freshness,
        ...(catalogPass
          ? {}
          : { remedy: "Restore or reinitialize the selected catalog document." }),
      },
      localState: {
        id: "local-state",
        status: localStatePass
          ? "pass"
          : localState.document === null
            ? "missing"
            : "invalid",
        verified: localStatePass,
        path: config.localState.path,
        revision: localState.revision,
        capabilities: localState.capabilities,
        freshness: localState.freshness,
        ...(localStatePass
          ? {}
          : { remedy: "Restore or reinitialize the selected machine-local state document." }),
      },
      store: {
        id: "store",
        status: catalogPass && localStatePass ? "pass" : "invalid",
        verified: catalogPass && localStatePass,
        adapters: {
          catalog: config.catalog.adapter,
          localState: config.localState.adapter,
        },
      },
    };
  } catch (error) {
    const code = error instanceof GovernanceError ? error.code : "INVALID_CONFIG";
    return {
      config: {
        id: "config",
        status: "invalid",
        path: configPath,
        validated: false,
        code,
        remedy: configRemedy,
      },
      trustedRoots: {
        id: "trusted-roots",
        status: "blocked",
        verified: false,
      },
      catalog: { id: "catalog", status: "blocked", verified: false },
      localState: {
        id: "local-state",
        status: "blocked",
        verified: false,
      },
      store: { id: "store", status: "blocked", verified: false },
    };
  }
}

export async function diagnose(
  options: DiagnoseOptions = {},
): Promise<DoctorDiagnosis> {
  const env = options.env ?? process.env;
  const config = selectConfigPath(options.configPath, env);
  const readinessScope = options.standalone === true ? "standalone" : "integration";
  const skill = readinessScope === "standalone" ? null : selectedSkill(options.skillPath, env);
  const runtimeCheck = checkNodeVersion(process.versions.node);
  const installCheck = await inspectInstall(
    env,
    options.cliPath ?? resolve(process.argv[1] ?? ""),
  );
  const pathLauncherCheck = await inspectPathLauncher(env);
  const git = spawnSync("git", ["--version"], {
    encoding: "utf8",
    env,
    timeout: 5_000,
    maxBuffer: 8_192,
    windowsHide: true,
  });
  const gitCheck =
    !git.error && git.status === 0 && /^git version \S+/.test(git.stdout.trim())
      ? { id: "git", status: "pass", actual: git.stdout.trim() }
      : {
          id: "git",
          status: "missing",
          remedy:
            "Install Git separately and make the trusted git executable available on PATH.",
        };
  const resources = await inspectConfiguredResources(config.path);
  const skillCheck = skill === null
    ? {
        id: "skill",
        status: "skipped",
        required: false,
        reason: "Agent skill integration is not required in standalone mode.",
      }
    : await inspectSkill(skill.path);
  const checks = [
    runtimeCheck,
    installCheck,
    pathLauncherCheck,
    gitCheck,
    resources.config,
    skillCheck,
    resources.trustedRoots,
    resources.catalog,
    resources.localState,
    resources.store,
  ];
  const remedies = checks
    .map((check) =>
      "remedy" in check && typeof check.remedy === "string"
        ? check.remedy
        : undefined,
    )
    .filter((value): value is string => value !== undefined);

  let error: DoctorDiagnosis["error"];
  if (runtimeCheck.status !== "pass" || gitCheck.status !== "pass")
    error = {
      code: "ACTION_FAILED",
      message: "A required runtime prerequisite is unavailable.",
      details: { remedies },
    };
  else if (resources.config.status === "missing")
    error = {
      code: "NOT_CONFIGURED",
      message: "Workspaces is not configured.",
      details: { remedies },
    };
  else if (
    resources.config.status !== "pass" ||
    resources.trustedRoots.status !== "pass" ||
    resources.store.status !== "pass"
  )
    error = {
      code: "INVALID_CONFIG",
      message: "The selected Workspaces setup is invalid or incomplete.",
      details: { remedies },
    };
  else if ((readinessScope === "integration" && skillCheck.status !== "pass") || installCheck.status === "invalid")
    error = {
      code: "INCOMPLETE",
      message: readinessScope === "standalone"
        ? "The CLI installation does not match the selected setup."
        : "The CLI installation or agent skill does not match the selected setup.",
      details: { remedies },
    };

  return {
    ok: error === undefined,
    command: "doctor",
    cliVersion: CLI_VERSION,
    milestone: "M2/A03",
    readinessScope,
    ready: error === undefined,
    selected: { config, skill },
    checks,
    ...(error === undefined ? {} : { error }),
  };
}

export function doctorExitCode(diagnosis: DoctorDiagnosis): number {
  if (diagnosis.ready) return 0;
  return diagnosis.error?.code === "ACTION_FAILED"
    ? 6
    : diagnosis.error?.code === "INCOMPLETE"
      ? 3
      : 2;
}

export function renderDoctorText(diagnosis: DoctorDiagnosis): string {
  const lines = [
    `Workspaces doctor — workspacectl ${diagnosis.cliVersion}`,
    `Readiness scope: ${diagnosis.readinessScope === "standalone" ? "standalone CLI" : "CLI + agent skill integration"}`,
    diagnosis.ready
      ? "Ready: yes"
      : `Ready: no (${diagnosis.error?.code ?? "INVALID_CONFIG"})`,
    `Selected config (${diagnosis.selected.config.source}): ${diagnosis.selected.config.path}`,
    diagnosis.selected.skill === null
      ? "Selected skill: not required"
      : `Selected skill (${diagnosis.selected.skill.source}): ${diagnosis.selected.skill.path}`,
    "Checks:",
  ];
  for (const check of diagnosis.checks) {
    const detail =
      check.id === "skill" && check.status === "skipped"
        ? " — not required"
        : typeof check.count === "number"
        ? ` — ${check.count}`
        : check.id === "install" &&
            typeof check.version === "string" &&
            typeof check.prefix === "string" &&
            typeof check.launcher === "string"
          ? ` — ${check.version} at ${check.prefix}; launcher ${check.launcher}`
          : typeof check.actual === "string"
            ? ` — ${check.actual}`
            : "";
    lines.push(`  [${check.status.toUpperCase()}] ${check.id}${detail}`);
  }
  if (diagnosis.error) {
    lines.push(diagnosis.error.message, "Remedies:");
    for (const remedy of diagnosis.error.details.remedies)
      lines.push(`  - ${remedy}`);
  }
  return lines.join("\n") + "\n";
}
