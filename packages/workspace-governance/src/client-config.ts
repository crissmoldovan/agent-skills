import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { GovernanceError } from "./core.ts";
import { READ_TOOL_NAMES } from "./read-service.ts";

export type McpClient = "generic" | "claude-code" | "codex" | "hermes";
export type McpClientScope = "selected-destination" | "local" | "project" | "user" | "profile";

export interface ClientConfigInput {
  client: McpClient;
  serverPath: string;
  configPath: string;
  destination?: string;
  scope?: string;
  home?: string;
  hermesHome?: string;
  cwd?: string;
}

export interface ClientConfigResult {
  status: "registration-generated";
  connected: false;
  profileWritten: false;
  client: McpClient;
  scope: McpClientScope;
  destination: string;
  command: string;
  args: ["--config", string];
  capabilities: "read-only";
  defaultTools: readonly string[];
  rendered: { format: "json" | "toml" | "yaml"; content: string; value: Record<string, unknown> };
  registrationCommand: { command: string; args: string[]; executed: false } | null;
  liveTestStatus: "documented-not-live-tested" | "portable-registration-data";
  guidance: { registration: string; permissions: string };
}

function invalid(reason: string): never {
  const error = new GovernanceError("INVALID_CONFIG", { reason });
  error.message = reason;
  throw error;
}

function absolute(value: string | undefined, label: string): string {
  if (!value || !isAbsolute(value)) invalid(`${label} must be an absolute path.`);
  if (value.includes("\0")) invalid(`${label} must not contain NUL.`);
  return value;
}

function tomlString(value: string): string {
  let rendered = '"';
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (character === '"') rendered += '\\"';
    else if (character === "\\") rendered += "\\\\";
    else if (character === "\b") rendered += "\\b";
    else if (character === "\t") rendered += "\\t";
    else if (character === "\n") rendered += "\\n";
    else if (character === "\f") rendered += "\\f";
    else if (character === "\r") rendered += "\\r";
    else if (code < 0x20 || code === 0x7f)
      rendered += `\\u${code.toString(16).padStart(4, "0")}`;
    else rendered += character;
  }
  return `${rendered}"`;
}

function yamlString(value: string): string {
  return JSON.stringify(value).replaceAll("\u0085", "\\u0085");
}

function jsonRegistration(command: string, args: readonly string[]) {
  return {
    mcpServers: {
      "workspace-governance": { type: "stdio", command, args: [...args] },
    },
  };
}

function stdioRegistration(command: string, args: readonly string[]) {
  return {
    mcp_servers: {
      "workspace-governance": { command, args: [...args] },
    },
  };
}

export function generateClientConfig(input: ClientConfigInput): ClientConfigResult {
  const serverPath = absolute(input.serverPath, "MCP server path");
  const configPath = absolute(input.configPath, "Workspaces config path");
  const home = absolute(input.home ?? homedir(), "Home path");
  const cwd = absolute(input.cwd ?? process.cwd(), "Project path");
  const args = ["--config", configPath] as const;

  let scope: McpClientScope;
  let destination: string;
  let rendered: ClientConfigResult["rendered"];
  let registrationCommand: ClientConfigResult["registrationCommand"] = null;
  let liveTestStatus: ClientConfigResult["liveTestStatus"] = "documented-not-live-tested";
  let permissions: string;

  if (input.client === "generic") {
    if (input.scope !== undefined) invalid("Generic registration does not accept a client scope; select a destination instead.");
    destination = absolute(input.destination, "Generic destination");
    scope = "selected-destination";
    const value = jsonRegistration(serverPath, args);
    rendered = { format: "json", value, content: `${JSON.stringify(value, null, 2)}\n` };
    liveTestStatus = "portable-registration-data";
    permissions = "The MCP host remains responsible for human permission prompts; automatic allow is trusted model authority, not human consent.";
  } else if (input.client === "claude-code") {
    const selectedScope = input.scope ?? "local";
    if (!["local", "project", "user"].includes(selectedScope)) invalid("Claude Code scope must be local, project, or user.");
    if (input.destination !== undefined) invalid("Claude Code destination is derived from its selected scope.");
    scope = selectedScope as "local" | "project" | "user";
    destination = scope === "project" ? join(cwd, ".mcp.json") : join(home, ".claude.json");
    const value = scope === "local"
      ? { projects: { [cwd]: jsonRegistration(serverPath, args) } }
      : jsonRegistration(serverPath, args);
    rendered = { format: "json", value, content: `${JSON.stringify(value, null, 2)}\n` };
    registrationCommand = {
      command: "claude",
      args: ["mcp", "add", "--scope", scope, "workspace-governance", "--", serverPath, ...args],
      executed: false,
    };
    permissions = "Claude Code ask is a host-mediated human prompt; allow and bypassPermissions grant trusted model authority. No permission rule is generated.";
  } else if (input.client === "codex") {
    const selectedScope = input.scope ?? "user";
    if (!["project", "user"].includes(selectedScope)) invalid("Codex scope must be project or user.");
    if (input.destination !== undefined) invalid("Codex destination is derived from its selected scope.");
    scope = selectedScope as "project" | "user";
    destination = scope === "project" ? join(cwd, ".codex", "config.toml") : join(home, ".codex", "config.toml");
    const value = stdioRegistration(serverPath, args);
    rendered = {
      format: "toml",
      value,
      content: `[mcp_servers.workspace-governance]\ncommand = ${tomlString(serverPath)}\nargs = [${args.map(tomlString).join(", ")}]\n`,
    };
    registrationCommand = scope === "user" ? {
      command: "codex",
      args: ["mcp", "add", "workspace-governance", "--", serverPath, ...args],
      executed: false,
    } : null;
    permissions = "Codex host policy selects auto, prompt, or approve: approve skips per-call prompting, while auto_review is automated review rather than human consent. No approval setting is generated.";
  } else if (input.client === "hermes") {
    if (input.scope !== undefined && input.scope !== "profile") invalid("Hermes scope must be profile.");
    if (input.destination !== undefined) invalid("Hermes destination is derived from HERMES_HOME or HOME.");
    scope = "profile";
    const hermesHome = absolute(input.hermesHome ?? join(home, ".hermes"), "Hermes home path");
    destination = join(hermesHome, "config.yaml");
    const value = stdioRegistration(serverPath, args);
    rendered = {
      format: "yaml",
      value,
      content: `mcp_servers:\n  workspace-governance:\n    command: ${yamlString(serverPath)}\n    args: [${args.map(yamlString).join(", ")}]\n`,
    };
    permissions = "Hermes tool visibility does not establish a per-call human-consent prompt; enabling automatic tool use is trusted model authority. No tool rule is generated.";
  } else invalid("Unsupported MCP client.");

  return {
    status: "registration-generated",
    connected: false,
    profileWritten: false,
    client: input.client,
    scope,
    destination,
    command: serverPath,
    args: [...args],
    capabilities: "read-only",
    defaultTools: READ_TOOL_NAMES,
    rendered,
    registrationCommand,
    liveTestStatus,
    guidance: {
      registration: "This output is registration guidance only. Generating it does not connect, initialize, list tools, call a tool, or write a client profile.",
      permissions,
    },
  };
}

export function installedMcpExecutable(env: NodeJS.ProcessEnv, cliEntryPath: string): string {
  if (env.WORKSPACECTL_LAUNCHER !== undefined) {
    const launcher = absolute(env.WORKSPACECTL_LAUNCHER, "Installed workspacectl launcher");
    if (join(dirname(launcher), "workspacectl") !== launcher)
      invalid("WORKSPACECTL_LAUNCHER must identify the installed workspacectl launcher.");
    return join(dirname(launcher), "workspacectl-mcp");
  }
  const entry = absolute(cliEntryPath, "Installed workspacectl package entry");
  if (basename(entry) !== "cli.js")
    invalid("Direct package mode requires the installed dist/cli.js entry.");
  return join(dirname(entry), "mcp-cli.js");
}
